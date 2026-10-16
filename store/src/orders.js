// An order in the storefront: one offer, one payment method, one eSIM.
//
//   awaiting_payment → delivered                        (the usual path)
//   awaiting_payment → refund_due                       (paid, but the wholesaler could not deliver)
//   awaiting_payment → underpaid                        (a push payment below the asked amount)
//   awaiting_payment → expired                          (nothing paid within a day)
//
// The price is fixed when the order is made and the terms (amount, memo, address) when its payment
// intent is made. Signed payments (USDC on Base) allocate before settlement; uncertain outcomes are
// held for reconciliation; pushed payments (TON) and cards (Stripe) are delivered after they arrive — so
// the wholesale balance is checked before an order is accepted at all.
//
// The buyer's way back to the eSIM is the order token: only its hash is stored, and the activation
// code is fetched from the wholesaler when the order page asks, never kept here.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { fulfil, release, transactionIdFor, status as profileStatus } from "../../rails/src/order.js";
import { asSupplier } from "../../rails/src/supplier.js";

const HOLD_MS = 20 * 60_000;           // how long a price and its payment terms hold
const WATCH_MS = 24 * 3_600_000;       // how long a pushed payment is looked for
const sha = (s) => createHash("sha256").update(s).digest("hex");

/**
 * `supplier`: a rails supplier.js Supplier (an eSIM Access client is wrapped). `events`: a rails
 * webhooks.js emitter — every order that changes status is told to the operator's own systems.
 */
export function createOrders({ db, supplier: configured, railsStore, statusSecret, methods, offersById, now = () => Date.now(), log = console,
                               qr = null, events = { emit() {} } }) {
  const supplier = asSupplier(configured);
  const method = (id) => methods.find((m) => m.id === id && m.enabled());

  async function load(id, token) {
    const o = await db.get(id);
    if (!o) return null;
    if (token !== undefined) {
      const a = Buffer.from(sha(String(token)));
      const b = Buffer.from(o.token_sha256);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    }
    return o;
  }
  // What the operator's systems hear about an order: never its token, never the activation code.
  const event = (o) => ({
    order_id: o.id, status: o.status, offer_id: o.offer?.offer_id, offer_name: o.offer?.name, price_usd: (o.price_cents / 100).toFixed(2),
    cost_usd: o.cost_usd ?? null, method: o.method, payment: o.payment ?? null, esim_tran_no: o.delivery?.esim_tran_no ?? null,
    error: o.error ?? null, created_at: o.created_at,
  });
  async function save(o) {
    const before = await db.get(o.id);
    await db.put(o.id, o);
    if (!before) events.emit("order.created", event(o));
    else if (before.status !== o.status) events.emit(`order.${o.status}`, event(o));
  }

  /** What the buyer's page shows; never the token, never the wholesale cost. */
  function view(o) {
    return {
      id: o.id, status: o.status, method: o.method, created_at: o.created_at, expires_at: o.expires_at,
      price_usd: (o.price_cents / 100).toFixed(2), offer: o.offer, intent: o.intent ?? null,
      payment: o.payment ? { ref: o.payment.ref, tx: o.payment.tx ?? null } : null,
      claim: o.claim ? { hash: o.claim.hash, confirming: Boolean(o.claim.confirming) } : null,
      error: o.error ?? null,
    };
  }

  async function deliver(o, ref) {
    // The cost the order was quoted at: a plan whose price moved since is refused, not charged.
    const cost = o.cost_usd ?? (o.wholesale_units ? o.wholesale_units / 10_000 : undefined);
    const { delivery } = await fulfil({ supplier, store: railsStore, secret: statusSecret,
                                        offer: { ...o.offer, _cost_usd: cost }, paymentRef: ref });
    o.delivery = { esim_tran_no: delivery.esim_tran_no, status_token: delivery.status_token };
    o.status = "delivered";
    o.delivered_at = new Date(now()).toISOString();
    return delivery;
  }

  // One writer for this store: payment reservation and delivery must not race a watcher or webhook.
  // The JSON backend supports one server process per data directory (no replicas sharing files).
  const api = {
    view,

    /** A new order for an offer and a method; the price holds for 20 minutes. */
    async create({ offerId, methodId, asset }) {
      const offer = offersById(offerId);
      if (!offer) return { error: "unknown_offer" };
      const m = method(methodId);
      if (!m) return { error: "unknown_method" };
      // A pushed payment cannot be refused once sent, so the wholesaler must be able to deliver first.
      let bal;
      try { bal = await supplier.balance(); } catch { return { error: "temporarily_unavailable" }; }
      if (bal && !(bal.usd >= offer._cost_usd)) return { error: "temporarily_unavailable" };   // null: no balance to watch
      const id = randomBytes(12).toString("base64url");
      const token = randomBytes(24).toString("base64url");
      const { _cost_usd, ...publicOffer } = offer;
      const o = {
        id, token_sha256: sha(token), status: "awaiting_payment", method: m.id,
        memo: `ESIM-${id.slice(0, 10).toUpperCase().replace(/[^A-Z0-9]/g, "X")}`,
        offer: publicOffer, price_cents: Math.round(Number(offer.price.usd) * 100), cost_usd: _cost_usd,
        created_at: new Date(now()).toISOString(), created_ms: now(), expires_at: now() + HOLD_MS,
      };
      o.intent = m.kind === "redirect" ? null : await m.intent(o, { asset });
      // An exact-amount method (Tron) tells orders apart by amount: no two open orders may ask the same.
      if (o.intent?.exact) {
        const open = (await db.all()).filter((x) => x.method === m.id && now() - x.created_ms <= WATCH_MS + 60_000);
        for (let i = 0; i < 8 && open.some((x) => x.intent?.units === o.intent.units); i++) o.intent = await m.intent(o, { asset });
        if (open.some((x) => x.intent?.units === o.intent.units)) return { error: "temporarily_unavailable" };
      }
      if (o.intent?.typed_data?.message?.validBefore) {
        o.expires_at = Math.min(o.expires_at, Number(o.intent.typed_data.message.validBefore) * 1000);
      }
      // A QR code of the payment link for wallets on another device.
      if (o.intent?.uri && qr) o.intent.qr = await qr(o.intent.uri).catch(() => null);
      await save(o);
      return { order: view(o), token };
    },

    async get(id, token) {
      const o = await load(id, token);
      if (!o) return null;
      const out = view(o);
      if (o.status === "delivered" && o.delivery) {
        try {
          out.esim = await profileStatus({ supplier, secret: statusSecret, esimTranNo: o.delivery.esim_tran_no,
                                           token: o.delivery.status_token });
        } catch (err) {
          out.esim = null;
          out.esim_error = err.code === "not_found" ? "not_found" : "supplier_unavailable";
        }
      }
      return out;
    },

    /** Signed methods: verify, deliver, then settle; an uncertain settlement is held for reconciliation. */
    async authorize(id, token, submission) {
      const o = await load(id, token);
      if (!o) return { error: "not_found" };
      if (o.status !== "awaiting_payment") return { error: "not_awaiting_payment", order: view(o) };
      if (now() > o.expires_at) { o.status = "expired"; await save(o); return { error: "expired", order: view(o) }; }
      const m = method(o.method);
      if (!m || m.kind !== "authorize") return { error: "wrong_method" };
      const v = await m.verify(o, submission);
      if (!v.ok) return { error: v.reason };
      if (m.prepare) {
        try { o.reconciliation = await m.prepare(o, v); }
        catch { return { error: "reconciliation_unavailable", order: view(o) }; }
      }
      try {
        await deliver(o, v.ref);
      } catch (err) {
        o.error = err.code || "delivery_failed";
        await save(o);
        return { error: o.error, order: view(o) };          // nothing settled: the buyer pays nothing
      }
      // Durable before money moves. A crash/timeout must never turn into an automatic second charge.
      o.status = "settlement_pending";
      o.payment = { ref: v.ref, payer: v.payer, tx: null };
      await save(o);
      let s;
      try { s = await m.settle(o, v); }
      catch { s = { ok: false, reason: "settlement_unknown" }; }
      if (!s.ok) {
        // A failure response can mean "already settled", or a lost response after a transfer.
        // Keep the profile and reservation for reconciliation; do not cancel or ask the buyer to pay twice.
        o.error = `settlement_pending:${s.reason}`;
        await save(o);
        return { error: "settlement_pending", order: view(o) };
      }
      o.status = "delivered";
      delete o.error;
      o.payment = { ref: v.ref, payer: v.payer, tx: s.tx };
      await save(o);
      return { order: view(o) };
    },

    /**
     * Hash-proved methods (EVM tokens): the buyer's wallet — or the buyer, pasting it — names the
     * transaction that paid. One transaction pays one order; the watcher keeps checking a claim
     * that is not confirmed yet.
     */
    async claim(id, token, hash, proof) {
      const o = await load(id, token);
      if (!o) return { error: "not_found" };
      if (o.status !== "awaiting_payment") return { order: view(o) };
      const m = method(o.method);
      if (!m || m.kind !== "claim") return { error: "wrong_method" };
      const h = String(hash || "").trim().toLowerCase();
      if (!/^0x[0-9a-f]{64}$/.test(h)) return { error: "not_a_hash" };
      const taken = (await db.all()).some((x) => x.id !== o.id && String(x.payment?.ref || "").endsWith(`:${h}`));
      if (taken) return { error: "used" };
      const owner = await m.claimOwner(o.intent, h, proof);
      if (!owner) return { error: "payer_signature_required" };
      o.claim = { hash: h, at: now(), payer: owner };
      await save(o);
      return this.checkClaim(o);
    },

    async checkClaim(o) {
      if (!o.claim?.payer) { delete o.claim; await save(o); return { error: "payer_signature_required", order: view(o) }; }
      let r;
      try { r = await method(o.method).verify(o.intent, o.claim.hash, { since: o.created_ms - 10 * 60_000, payer: o.claim.payer }); }
      catch { return { order: view(o) }; }                       // the network did not answer: try again later
      if (r.status === "pending") { o.claim.confirming = Boolean(r.confirming); await save(o); return { order: view(o) }; }
      if (r.status !== "paid") {
        const reason = r.status === "failed" ? "failed" : r.reason || "wrong";
        delete o.claim;
        await save(o);
        return { error: reason, order: view(o) };
      }
      if (r.payer?.toLowerCase() !== o.claim.payer.toLowerCase()) {
        delete o.claim; await save(o); return { error: "wrong_payer", order: view(o) };
      }
      if ((await db.all()).some(x => x.id !== o.id && x.payment?.ref === r.ref)) return { error: "used" };
      o.payment = { ref: r.ref, payer: r.payer, units: r.units };
      await save(o);
      delete o.claim;
      try { await deliver(o, r.ref); } catch (err) { o.status = "refund_due"; o.error = err.code || "delivery_failed"; }
      await save(o);
      return { order: view(o) };
    },

    /** TON Connect needs the buyer's address for a USD₮ transfer: the message for this order. */
    async tonMessage(id, token, buyer) {
      const o = await load(id, token);
      if (!o || o.method !== "ton" || o.intent?.asset !== "USDT") return { error: "not_found" };
      return { message: await method("ton").jettonMessage(o.intent, buyer, o.expires_at) };
    },

    /** Resume uncertain signed payments after a lost response or process restart. No second charge. */
    async reconcile() {
      for (const o of (await db.all()).filter(x => x.status === "settlement_pending")) {
        const m = methods.find(m => m.id === o.method); // Read-only recovery also works when new sales are disabled.
        if (!m?.reconcile || !o.reconciliation) continue;
        const r = o.reconciliation.outcome || await m.reconcile(o.reconciliation);
        if (r.nextBlock) o.reconciliation.nextBlock = r.nextBlock;
        o.reconciliation.last_check = new Date(now()).toISOString();
        o.reconciliation.reason = r.reason ?? null;
        if (r.status === "paid") {
          o.payment.tx = r.transaction;
          o.status = "delivered";
          o.reconciliation.outcome = r;
          delete o.error;
          await save(o);
        } else if (r.status === "unpaid") {
          // Durable before cancelling. A crash resumes cancellation, not another payment.
          o.reconciliation.outcome = r;
          await save(o);
          try {
            await release({ supplier, store: railsStore, transactionId: transactionIdFor(o.payment.ref) });
            delete o.delivery;
            o.status = "payment_failed";
            o.error = r.reason;
          } catch { o.error = "cancellation_pending"; }
          await save(o);
        } else { await save(o); }
      }
    },

    /** Pushed methods: look for each open order's payment and deliver the paid ones. */
    async watch() {
      const all = await db.all();
      // Nothing paid for a day, whatever the method: the order is over (a pending claim keeps it open).
      for (const o of all.filter((x) => x.status === "awaiting_payment" && !x.claim && now() - x.created_ms > WATCH_MS)) {
        o.status = "expired";
        await save(o);
      }
      // Claimed EVM transfers: confirm them, or drop a claim that turned out wrong.
      for (const o of all.filter((x) => x.status === "awaiting_payment" && x.claim && method(x.method)?.kind === "claim")) {
        await this.checkClaim(o);
      }
      const open = all.filter((o) => o.status === "awaiting_payment" && method(o.method)?.kind === "push");
      for (const o of open) {
        if (now() - o.created_ms > WATCH_MS) { o.status = "expired"; await save(o); continue; }
        if (!o.intent) continue;
        let found;
        try { found = await method(o.method).find(o.intent, { since: o.created_ms - 60_000 }); } catch { continue; }
        if (found.status === "pending") continue;
        if (!found.ref || (await db.all()).some(x => x.id !== o.id && x.payment?.ref === found.ref)) continue;
        o.payment = { ref: found.ref, payer: found.payer, units: found.units };
        await save(o);
        if (found.status === "underpaid") { o.status = "underpaid"; await save(o); continue; }
        try { await deliver(o, found.ref); } catch (err) { o.status = "refund_due"; o.error = err.code || "delivery_failed"; }
        await save(o);
      }
    },

    /** Stripe's webhook: a paid checkout delivers its order. */
    async cardPaid(rawBody, signature) {
      const m = method("stripe");
      if (!m) return { error: "unknown_method" };
      const paid = m.paidFromWebhook(rawBody, signature);
      if (!paid) return { ignored: true };
      if (paid.error) return { error: paid.error };
      const o = await load(paid.orderId);
      if (!o || o.status !== "awaiting_payment") return { ignored: true };
      if ((await db.all()).some(x => x.id !== o.id && x.payment?.ref === paid.ref)) return { error: "used" };
      o.payment = { ref: paid.ref };
      await save(o);
      if (paid.amountCents < o.price_cents) { o.status = "underpaid"; await save(o); return { order: view(o) }; }
      try { await deliver(o, paid.ref); } catch (err) { o.status = "refund_due"; o.error = err.code || "delivery_failed"; }
      await save(o);
      return { order: view(o) };
    },

    /** Cards: the Checkout Session to send the buyer to. */
    async cardCheckout(id, token, orderUrl) {
      const o = await load(id, token);
      if (!o || o.method !== "stripe" || o.status !== "awaiting_payment") return { error: "not_found" };
      return { redirect: (await method("stripe").intent(o, { orderUrl })).redirect };
    },
  };
  let queue = Promise.resolve();
  const exposed = { view: api.view, get: api.get.bind(api) };
  for (const name of ["create", "authorize", "claim", "tonMessage", "watch", "reconcile", "cardPaid", "cardCheckout"]) {
    exposed[name] = (...args) => {
      const run = queue.then(() => api[name](...args));
      queue = run.catch(() => {});
      return run;
    };
  }
  return exposed;
}

/** Orders in one JSON file, written whole and atomically. Enough for a shop's first thousands of orders. */
export function jsonDb(path, fs) {
  let chain = Promise.resolve();
  const read = async () => { try {
    const data = JSON.parse(await fs.readFile(path, "utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("order store must be a JSON object");
    return data;
  } catch (err) { if (err.code === "ENOENT") return {}; throw err; } };
  return {
    get: async (id) => (await read())[id] ?? null,
    all: async () => Object.values(await read()),
    put: (id, value) => {
      chain = chain.catch(() => {}).then(async () => {
        const all = await read();
        all[id] = value;
        await fs.writeFile(`${path}.tmp`, JSON.stringify(all), { mode: 0o600 });
        await fs.rename(`${path}.tmp`, path);
      });
      return chain;
    },
  };
}
