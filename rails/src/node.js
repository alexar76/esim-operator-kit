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
// whose settlement is uncertain is held for reconciliation without another charge.
//
// A quote is a price the seller keeps for a while (quote.js): every offer carries a quote_token and
// price_valid_until. An order that brings the token pays at most the quoted price while it is valid,
// never below the wholesale cost; when the price rose and the quote expired, or the supplier refused
// the order, the answer is the offer as it is now with a fresh token, not a bare error.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as edSign } from "node:crypto";
import express from "express";
import { SupplierError } from "./esimaccess.js";
import { offersFromPlans, publicOffer, quote } from "./offers.js";
import { atPrice, centsOf, issueQuote, priceForQuote, quoteKey, readQuote, usdOf } from "./quote.js";
import { asSupplier } from "./supplier.js";
import { fulfil, status, transactionIdFor, refund, release } from "./order.js";
import { usdcUnits } from "./refund.js";

/** Why an order that brought a quote_token is not sold at either price (409, before any payment). */
const QUOTE_REFUSALS = {
  quote_expired: "the quote has expired and the price has gone up since; you were not charged. current_offer is a fresh quote: order again with its quote_token to pay its price",
  quote_below_cost: "the wholesale cost has risen above the quoted price, so this seller cannot keep it; you were not charged. current_offer is a fresh quote: order again with its quote_token to pay its price",
};

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

/**
 * `supplier`: a supplier.js Supplier (an eSIM Access client is wrapped). `events`: a webhooks.js
 * emitter for the operator's own systems (agent_order.delivered, agent_order.cancelled).
 */
export function createNode({
  supplier: configured, store, secret, signer, publicUrl, paywall = null, refunder = null, events = { emit() {} },
  pricing = {}, productId = "esim-rails", sellerName = "eSIM seller", catalogTtlMs = 15 * 60_000, quoteTtlMs = 10 * 60_000,
  now = () => Date.now(), orderWaitMs = 45_000, log = console, demo = false, reconciler = null,
}) {
  if (!secret || String(secret).length < 16) throw new Error("the node needs a status secret of 16+ characters");
  const supplier = asSupplier(configured);
  const settlementReader = reconciler || paywall?.reconciler;
  if (settlementReader && typeof store.all !== "function") throw new Error("automatic reconciliation requires store.all()");
  const origin = String(publicUrl || "").replace(/\/+$/, "");
  let catalog = { at: 0, offers: [], byId: new Map() };
  let loading = null;
  const qkey = quoteKey(secret);
  const iso = (ms) => new Date(ms).toISOString();

  /** The catalogue, read again when older than catalogTtlMs, or now with `force` (after a refused order). */
  async function offers({ force = false } = {}) {
    if (!force && now() - catalog.at < catalogTtlMs && catalog.offers.length) return catalog;
    loading ??= (async () => {
      try {
        const list = offersFromPlans(await supplier.catalog(), pricing);
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

  /** The offer as a quote would give it now: public fields, a fresh token and its validity. */
  const freshOffer = (offer) => {
    const pub = publicOffer(offer);
    return quoteTtlMs > 0 ? { ...pub, ...issueQuote(qkey, pub, now() + quoteTtlMs) } : pub;
  };

  /**
   * What an order for the catalogue's `offer` pays with `token` (absent, or from esim.quote):
   * → {offer} to sell (at the honoured or current price, with the current wholesale cost), or
   *   {error: "bad_quote_token" | "quote_expired" | "quote_below_cost"}.
   */
  function pricedOrder(offer, token) {
    if (token === undefined || token === null || token === "") return { offer: { ...offer, _list_usd: offer.price.usd } };
    const q = readQuote(qkey, token, offer.offer_id);
    if (!q) return { error: "bad_quote_token" };
    const p = priceForQuote(offer, q, now());
    if (p.kind === "expired") return { error: "quote_expired" };
    if (p.kind === "below_cost") return { error: "quote_below_cost" };
    if (p.kind === "current") return { offer: { ...offer, _list_usd: offer.price.usd } };
    return { offer: { ...atPrice(offer, p.cents), _quoted: true, _list_usd: offer.price.usd } };   // honoured
  }

  // The price the pre-paywall step decided for a request body, so the x402 terms and the order agree
  // even if the catalogue is read again or the quote expires in between.
  const decided = new WeakMap();
  /** The price the paywall asks for an order body ({offer_id, quote_token?}) or a bare offer_id; null: not sold. */
  function priceOf(bodyOrId) {
    if (bodyOrId && typeof bodyOrId === "object" && decided.has(bodyOrId)) return decided.get(bodyOrId);
    const body = bodyOrId && typeof bodyOrId === "object"
      ? (bodyOrId.input && typeof bodyOrId.input === "object" ? bodyOrId.input : bodyOrId) : { offer_id: bodyOrId };
    const offer = catalog.byId.get(String(body.offer_id ?? ""));
    if (!offer) return null;
    const priced = pricedOrder(offer, body.quote_token);
    return priced.offer ? priced.offer.price.usd : null;
  }

  /**
   * After the supplier said no to `refused` (the offer as it was sold): read the catalogue again and
   * say what an order would get now. With the buyer's token still good for the new cost, the same
   * token keeps its price; otherwise a fresh token at today's price.
   */
  async function afterRefusal(refused, token) {
    const base = "the supplier refused this order; you were not charged";
    const before = catalog;   // a successful read replaces the object; a failed one serves this one again
    let cat;
    try { cat = await offers({ force: true }); } catch { return { message: base, fields: {} }; }
    if (cat === before) return { message: `${base}. The catalogue could not be read again; quote again later`, fields: {} };
    const offer = cat.byId.get(refused.offer_id);
    if (!offer) {
      return { message: `${base}. This offer is no longer sold; quote again for another`,
               fields: { offer_withdrawn: true, catalogue_at: iso(cat.at) } };
    }
    const changed = offer._cost_usd !== refused._cost_usd || offer.price.usd !== refused._list_usd;
    const q = token ? readQuote(qkey, token, offer.offer_id) : null;
    const p = q ? priceForQuote(offer, q, now()) : null;
    const current_offer = p?.kind === "honoured"
      ? { ...publicOffer(atPrice(offer, p.cents)), quote_token: token, price_valid_until: iso(q.untilMs) }
      : freshOffer(offer);
    return {
      message: changed
        ? `${base}. The wholesale catalogue has changed: current_offer is this offer now; order again with its quote_token`
        : `${base}. The catalogue has not changed, so the refusal had another cause; try later or another seller`,
      fields: { current_offer, catalogue_changed: changed, catalogue_at: iso(cat.at) },
    };
  }

  const signed = (res, capabilityId, input, result) =>
    res.set("X-Provider-Signature", signer.sign(boundCanonical(capabilityId, productId, input, result)))
      .json({ success: true, result });
  const refuse = (res, status, error, message) => res.status(status).json({ success: false, error, message });
  // A receipt this seller signs with its provider key (the key its listing and node.toml publish):
  // a buyer may bring it, with the transaction, to a hub as evidence the seller delivered or
  // refunded (aimarket-hub deliveries.py). No secret in it: who paid, to whom, the payment's nonce.
  const receiptOf = (fields) => {
    const receipt = Object.fromEntries(Object.entries({ v: 1, capability: CAPABILITIES.order, product_id: productId, chain_id: 8453, ...fields })
      .filter(([, value]) => value !== undefined && value !== null));
    return { receipt, receipt_signature: signer.sign(canonicalJson(receipt)) };
  };
  const inputOf = (req) => {
    const b = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    return b.input && typeof b.input === "object" && !Array.isArray(b.input) ? b.input : b;
  };

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback, uniquelocal");
  app.use(express.json({ limit: "32kb" }));
  // The free routes are a public API any page may call (no cookies, nothing that needs credentials):
  // the kit's landing asks the demo node for live offers. The paid order is for agents, not pages.
  const PUBLIC = new Set(["/quote", "/quote/invoke", "/status", "/status/invoke", "/refund", "/healthz", "/listing.json"]);
  app.use((req, res, next) => {
    if (!PUBLIC.has(req.path)) return next();
    res.set({ "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
              "Access-Control-Allow-Headers": "content-type", "Access-Control-Expose-Headers": "X-Provider-Signature",
              "Access-Control-Max-Age": "600" });
    return req.method === "OPTIONS" ? res.status(204).end() : next();
  });

  app.get("/healthz", async (_req, res) => {
    let count = null;
    let countries = null;
    try {
      const list = (await offers()).offers;
      count = list.length;
      // How far the catalogue reaches, for maps and directories that draw this seller.
      countries = new Set(list.flatMap((o) => o.coverage?.countries || [])).size;
    } catch { count = null; }
    res.json({ ok: count !== null, offers: count, countries, provider_pubkey: signer.pubkey, paid_orders: Boolean(paywall) && !demo, demo,
               refunds: refunder ? "automatic" : "operator",
               reconciliation: settlementReader && typeof store.all === "function" ? "finalized-base" : "operator",
               // "snapshot": the supplier does not answer and the last catalogue it gave is served (snapshot.js)
               ...(typeof supplier.info === "function" ? { catalog: supplier.info() } : {}),
               capabilities: Object.values(CAPABILITIES) });
  });

  /** Public quote listing, plus direct order, status and refund endpoints. */
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
      ],
      order: { capability_id: CAPABILITIES.order, url: `${origin}/order`, method: "POST", body: { offer_id: "<from esim.quote>" },
               payment: "x402 exact, USDC on Base, the offer's price, paid to this seller",
               recovery: "Send a private random X-Esim-Recovery header (32+ base64url characters) from the first request to recover a settled delivery after a lost response. Never publish it." },
      status: { capability_id: CAPABILITIES.status, url: `${origin}/status`, method: "POST", direct_only: true,
                body: { esim_tran_no: "<from the delivery>", status_token: "<from the delivery>" } },
      refund: { url: `${origin}/refund`, method: "POST", body: { esim_tran_no: "<from the delivery>", status_token: "<from the delivery>" },
                policy: "an unused eSIM (not installed, no data spent): cancelled, and the price paid back to the paying address"
                  + (refunder ? " automatically, in USDC on Base" : " by the seller") },
    });
  });

  async function quoteRoute(req, res) {
    const input = inputOf(req);
    let cat;
    try { cat = await offers(); } catch { return refuse(res, 503, "catalogue_unavailable", "the wholesale catalogue cannot be read right now"); }
    let list;
    try { list = quote(cat.offers, input); } catch (err) { return refuse(res, 400, "bad_input", err.message); }
    if (quoteTtlMs > 0) {
      const until = now() + quoteTtlMs;
      list = list.map((o) => ({ ...o, ...issueQuote(qkey, o, until) }));
    }
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
      const st = await status({ supplier, secret, esimTranNo: input.esim_tran_no, token: input.status_token });
      return signed(res, req.body?.capability_id || CAPABILITIES.status, input, st);
    } catch (err) {
      if (err.code === "not_found") return refuse(res, 404, "not_found", err.message);
      return refuse(res, 502, "supplier_error", "the supplier did not answer; try again");
    }
  }
  app.post(["/status", "/status/invoke"], statusRoute);

  // A refund of an unused eSIM, asked for by whoever holds its status token. Not signed: it is an
  // answer about money, and the transaction it names is the proof. Before the paywall, which guards /order only.
  app.post("/refund", async (req, res) => {
    const input = inputOf(req);
    try {
      const r = await refund({ supplier, store, secret, esimTranNo: input.esim_tran_no, token: input.status_token, refunder });
      if (r.status === "refunded" || r.status === "due") {
        events.emit(r.status === "refunded" ? "agent_order.refunded" : "agent_order.refund_due",
                    { esim_tran_no: input.esim_tran_no, amount_usd: r.amount_usd, to: r.to, transaction: r.transaction ?? null });
      }
      const { attempted: _a, error: _e, refund_from: from, refund_nonce: rnonce, delivery_nonce: dnonce, ...answer } = r;
      // A refund the seller paid, in its own signed words: a buyer may bring it to a hub with the
      // transaction, and the hub counts "refunds honoured" for this seller (aimarket-hub deliveries.py).
      const proof = r.status === "refunded" && from && rnonce
        ? receiptOf({ kind: "refund", payer: r.to, refund_from: from, refund_nonce: rnonce, delivery_nonce: dnonce ?? undefined, at: r.at })
        : {};
      return res.set("Cache-Control", "no-store").json({ success: true, result: { esim_tran_no: input.esim_tran_no, ...answer, ...proof } });
    } catch (err) {
      if (err.code === "not_found") return refuse(res, 404, "not_found", err.message);
      if (["in_use", "settlement_pending"].includes(err.code)) return refuse(res, 409, err.code, err.message);
      log.error?.(`refund failed: ${err.code || err.message}`);
      return refuse(res, 502, "supplier_error", "the supplier did not answer; ask again later");
    }
  });

  const inFlight = new Map();
  // Hold a per-payment lock through verification AND settlement (including the buffered response).
  app.post("/order", async (req, res, next) => {
    const header = req.get("payment-signature") || req.get("x-payment") || "";
    const ref = paymentRefOfHeader(header);
    if (!ref) return next();
    const previous = inFlight.get(ref) || Promise.resolve();
    let unlock;
    const turn = new Promise(resolve => { unlock = resolve; });
    const tail = previous.then(() => turn);
    inFlight.set(ref, tail);
    await previous;
    let finished = false;
    const done = () => { if (finished) return; finished = true; unlock(); if (inFlight.get(ref) === tail) inFlight.delete(ref); };
    res.once("finish", done); res.once("close", done);
    if (res.destroyed) { done(); return; }
    const recovery = String(req.get("x-esim-recovery") || "");
    req.recoveryHash = /^[A-Za-z0-9_-]{32,128}$/.test(recovery) ? createHash("sha256").update(recovery).digest("hex") : null;
    req.paymentHash = createHash("sha256").update(header).digest("hex");
    const record = await store.get(transactionIdFor(ref));
    if (record?.settlement) {
      if (record.paymentHash !== req.paymentHash) return refuse(res, 409, "payment_conflict", "use the original signed payment");
      if (record.released || record.refund) return refuse(res, 409, "order_closed", "this eSIM was cancelled or refunded");
      if (record.offerId !== String(inputOf(req).offer_id || "")) return refuse(res, 409, "payment_conflict", "this payment belongs to another offer");
      if (record.settlement.status === "unpaid") return refuse(res, 409, "payment_not_received", "this authorization cannot pay; the order is closed");
      if (!["settled", "procurement_pending"].includes(record.settlement.status)) return refuse(res, 409, "settlement_pending", "payment outcome needs reconciliation; do not pay again");
      // Payment signatures/authorization nonces can become public on chain. They are NOT a recovery secret.
      if (!record.recoveryHash || record.recoveryHash !== req.recoveryHash) {
        return refuse(res, 409, "recovery_required", "use the private X-Esim-Recovery value from the original request");
      }
      if (record.settlement.status === "settled") {
        req.paidReplay = record.settlement;
        req.recoveredOffer = record.offer;
      }
    }
    return next();
  });

  // The order: an unknown offer is a 400 before any price is asked; then the paywall; then the order.
  app.post("/order", async (req, res, next) => {
    // Recover an already paid order even if new sales are off or the catalogue has changed.
    if (req.paidReplay && req.recoveredOffer) { req.offer = req.recoveredOffer; return next(); }
    const id = String(inputOf(req).offer_id || "");
    let cat;
    try { cat = await offers(); } catch { return refuse(res, 503, "catalogue_unavailable", "the wholesale catalogue cannot be read right now"); }
    const offer = cat.byId.get(id);
    if (!offer) return refuse(res, 400, "unknown_offer", "send offer_id from esim.quote");
    const priced = pricedOrder(offer, inputOf(req).quote_token);
    if (priced.error === "bad_quote_token") {
      return refuse(res, 400, "bad_quote_token", "quote_token is not one this seller issued for this offer_id: send it as esim.quote returned it, or leave it out to pay the current price");
    }
    if (priced.error) return res.status(409).json({ success: false, error: priced.error, message: QUOTE_REFUSALS[priced.error],
                                                     current_offer: freshOffer(offer), catalogue_at: iso(cat.at) });
    if (demo) return refuse(res, 403, "demo_mode", supplier.kind === "sample"
      ? "demo mode: this node quotes made-up sample prices and sells nothing; connect a wholesale account to sell"
      : "demo mode: this node quotes live prices and sells nothing; run your own node to sell");
    if (!paywall) return refuse(res, 503, "payments_off", "this node does not take payments yet");
    req.offer = priced.offer;
    if (req.body && typeof req.body === "object") decided.set(req.body, priced.offer.price.usd);   // the paywall asks exactly this (priceOf)
    return next();
  });
  if (paywall) app.use((req, res, next) => req.paidReplay ? next() : paywall.middleware(req, res, next));
  app.post("/order", async (req, res) => {
    const paymentRef = paymentRefOfHeader(req.get("payment-signature") || req.get("x-payment") || "");
    if (!paymentRef) return refuse(res, 400, "no_payment_reference", "the payment carries no payer and nonce");
    try {
      let checkpoint;
      if (settlementReader && !req.paidReplay) {
        try {
          const payload = JSON.parse(Buffer.from(req.get("payment-signature") || req.get("x-payment"), "base64").toString("utf8"));
          checkpoint = await settlementReader.prepare(payload.payload?.authorization, { to: paywall.payTo, value: usdcUnits(req.offer.price.usd) });
        } catch { return refuse(res, 503, "reconciliation_unavailable", "payment recovery is unavailable; nothing was charged, try later"); }
      }
      const offer = publicOffer(req.offer);   // what the buyer sees and the record keeps: no wholesale cost
      const recovery = paywall?.tracksSettlement && !req.paidReplay ? {
        offer, paymentHash: req.paymentHash, recoveryHash: req.recoveryHash,
        settlement: { status: "procurement_pending", payTo: paywall.payTo, at: new Date(now()).toISOString(),
          ...(checkpoint ? { reconciliation: checkpoint } : {}) },
      } : null;
      const { delivery } = await fulfil({ supplier, store, secret, offer: req.offer, paymentRef, maxWaitMs: orderWaitMs, recovery });
      // What a buyer may show a hub: this seller delivered the order paid with this authorization.
      const [payer, nonce] = paymentRef.split(":");
      const payTo = req.paidReplay?.payTo || paywall?.payTo;
      const proof = payTo
        ? receiptOf({ kind: "delivery", payer, pay_to: payTo, nonce, offer_id: offer.offer_id, at: new Date(now()).toISOString() })
        : {};
      if (paywall?.tracksSettlement && !req.paidReplay) {
        const id = transactionIdFor(paymentRef), record = await store.get(id);
        await store.put(id, { ...record, offer, paymentHash: req.paymentHash, recoveryHash: req.recoveryHash, settlement: { status: "pending", payTo: paywall.payTo, at: new Date(now()).toISOString(), ...(checkpoint ? { reconciliation: checkpoint } : {}) } });
      }
      if (req.paidReplay?.response) res.set("PAYMENT-RESPONSE", req.paidReplay.response);
      if (!paywall?.tracksSettlement && !req.paidReplay) events.emit("agent_order.delivered", { offer_id: offer.offer_id, price_usd: offer.price.usd, payment_ref: paymentRef,
                                             payer: paymentRef.split(":")[0], order_no: delivery.order_no,
                                             esim_tran_no: delivery.esim_tran_no, iccid: delivery.iccid });
      return res.set("Cache-Control", "no-store").json({ success: true, result: { ...delivery, offer, ...proof } });
    } catch (err) {
      if (err.code === "order_closed") return refuse(res, 409, err.code, err.message);
      if (err.code === "allocation_pending") {
        return res.status(503).set("Retry-After", "20").json({ success: false, error: "allocation_pending", message: err.message });
      }
      if (err instanceof SupplierError) {
        // 2000xx: the plan, its price or the order was refused — the buyer is not charged.
        if (err.retryable) return refuse(res, 503, `supplier_${err.code}`, "the supplier refused this order; you were not charged");
        // A "no" can mean the catalogue the price came from is out of date: read it again now, not at the
        // next refresh, and answer with the offer as an order would get it now.
        const after = await afterRefusal(req.offer, inputOf(req).quote_token);
        return res.status(409).json({ success: false, error: `supplier_${err.code}`, message: after.message, ...after.fields });
      }
      log.error?.(`order failed: ${err.message}`);
      return refuse(res, 500, "internal_error", "the order failed; you were not charged");
    }
  });

  let stateQueue = Promise.resolve();
  const changeState = work => {
    const run = stateQueue.then(work);
    stateQueue = run.catch(() => {});
    return run;
  };

  /** Unknown settlement is never proof that the buyer did not pay. */
  function settleFailed(paymentPayload) { return changeState(async () => {
    const ref = paymentRefOf(paymentPayload);
    if (!ref) return false;
    const id = transactionIdFor(ref), record = await store.get(id);
    if (!record || ["settled", "unpaid"].includes(record.settlement?.status)) return false;
    await store.put(id, { ...record, settlement: { ...record.settlement, status: "pending", at: new Date(now()).toISOString() } });
    events.emit("agent_order.settlement_pending", { payment_ref: ref, reason: "settlement_unknown" });
    return true;
  }); }

  function settled(paymentPayload, result) { return changeState(() => recordSettled(paymentPayload, result)); }

  async function recordSettled(paymentPayload, result) {
    const ref = paymentRefOf(paymentPayload);
    if (!ref || !result?.success) return false;
    const id = transactionIdFor(ref), record = await store.get(id);
    if (!record || ["settled", "unpaid"].includes(record.settlement?.status)) return false;
    await store.put(id, { ...record, settlement: { ...record.settlement, status: "settled", tx: result.transaction,
      response: Buffer.from(JSON.stringify(result)).toString("base64"), at: new Date(now()).toISOString() } });
    events.emit("agent_order.delivered", { offer_id: record.offerId, price_usd: record.priceUsd, payment_ref: ref,
      payer: record.payer, order_no: record.orderRef, esim_tran_no: record.profileId, iccid: record.iccid });
    return true;
  }

  let reconciling = null;
  function reconcile() {
    reconciling ??= reconcileOnce().finally(() => { reconciling = null; });
    return reconciling;
  }
  async function reconcileOnce() {
    if (!settlementReader || typeof store.all !== "function") return;
    for (const candidate of await store.all()) {
      if (!candidate.transactionId || !candidate.payer || !candidate.nonce) continue;
      const ref = `${candidate.payer}:${candidate.nonce}`;
      if (inFlight.has(ref)) continue;
      let unlock;
      const lock = new Promise(resolve => { unlock = resolve; });
      inFlight.set(ref, lock);
      try {
        const record = await store.get(candidate.transactionId), s = record?.settlement;
        if (!s?.reconciliation || !["procurement_pending", "pending", "unpaid"].includes(s.status) || record.released) continue;
        const r = s.reconciliation.outcome || await settlementReader.resolve(s.reconciliation);
        await changeState(async () => {
          const latest = await store.get(record.transactionId);
          if (!latest || latest.released || latest.settlement?.status === "settled") return;
          const checkpoint = { ...latest.settlement.reconciliation, last_check: new Date(now()).toISOString(), reason: r.reason ?? null,
            ...(r.nextBlock ? { nextBlock: r.nextBlock } : {}), ...(["paid", "unpaid"].includes(r.status) ? { outcome: r } : {}) };
          await store.put(record.transactionId, { ...latest, settlement: { ...latest.settlement, reconciliation: checkpoint,
            ...(r.status === "unpaid" ? { status: "unpaid" } : {}) } });
          if (r.status === "paid") {
            if (!latest.profileId && !latest.esimTranNo) {
              await fulfil({ supplier, store, secret,
                offer: { ...latest.offer, _cost_usd: latest.costUsd }, paymentRef: ref, maxWaitMs: orderWaitMs });
            }
            await recordSettled({ payload: { authorization: checkpoint } }, { success: true, transaction: r.transaction, network: "eip155:8453", payer: checkpoint.from });
          } else if (r.status === "unpaid") {
            if (await release({ supplier, store, transactionId: record.transactionId })) {
              events.emit("agent_order.cancelled", { payment_ref: ref, reason: r.reason });
            }
          }
        });
      } catch { log.error?.("payment reconciliation deferred; durable state retained"); }
      finally { unlock(); if (inFlight.get(ref) === lock) inFlight.delete(ref); }
    }
  }

  app.use((_req, res) => refuse(res, 404, "not_found", "see /listing.json"));
  return { app, offers, settleFailed, settled, reconcile, priceOf };
}
