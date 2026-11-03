// Cards through Stripe Checkout — written, tested, and off until the seller sets its keys
// (STRIPE_SECRET_KEY_FILE, STRIPE_WEBHOOK_SECRET_FILE). Turning it on is configuration, not code.
//
// The buyer is redirected to a Checkout Session for exactly the order's price; Stripe calls the
// webhook when it is paid, the webhook is checked against Stripe-Signature (HMAC-SHA256 over
// "t.payload" with the endpoint secret, five minutes' tolerance), and the order is delivered then.
// No card data ever reaches the storefront. Talks to Stripe's REST API directly: no SDK.
import { createHmac, timingSafeEqual } from "node:crypto";

const form = (obj, prefix = "", out = new URLSearchParams()) => {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v && typeof v === "object") form(v, key, out);
    else if (v !== undefined && v !== null) out.append(key, String(v));
  }
  return out;
};

/** Check a Stripe webhook: the event when the signature is good and fresh, otherwise null. */
export function verifyWebhook(rawBody, header, secret, { nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300 } = {}) {
  const parts = Object.fromEntries(String(header || "").split(",").map((p) => p.split("=")).filter((p) => p.length === 2)
    .map(([k, v]) => [k.trim(), v.trim()]));
  const t = Number(parts.t);
  const signatures = String(header || "").split(",").filter((p) => p.trim().startsWith("v1=")).map((p) => p.trim().slice(3));
  if (!Number.isInteger(t) || !signatures.length || Math.abs(nowSec - t) > toleranceSec) return null;
  const want = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const ok = signatures.some((s) => /^[a-f0-9]{64}$/.test(s) && timingSafeEqual(Buffer.from(s), Buffer.from(want)));
  if (!ok) return null;
  try { return JSON.parse(rawBody); } catch { return null; }
}

export function stripeCards({ secretKey = "", webhookSecret = "", publicUrl = "", fetchImpl = globalThis.fetch,
                              api = "https://api.stripe.com" }) {
  async function readSession(id, { includeCharge = false } = {}) {
    const expand = includeCharge ? "?expand%5B%5D=payment_intent.latest_charge" : "";
    const res = await fetchImpl(`${api}/v1/checkout/sessions/${encodeURIComponent(id)}${expand}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error("stripe reconciliation unavailable");
    return res.json();
  }

  function matchesOrder(s, order, id) {
    return s.id === id && s.client_reference_id === order.id && s.metadata?.order_id === order.id
      && s.mode === "payment" && s.currency === "usd";
  }

  return {
    id: "stripe",
    kind: "redirect",
    label: "Card",
    enabled: () => Boolean(secretKey && webhookSecret),

    /** A Checkout Session for this order; the buyer goes to its URL. */
    async intent(order, { orderUrl }) {
      const body = form({
        mode: "payment",
        client_reference_id: order.id,
        success_url: orderUrl,
        cancel_url: orderUrl,
        "metadata[order_id]": order.id,
        "payment_intent_data[metadata][order_id]": order.id,
        line_items: { 0: { quantity: 1, price_data: { currency: "usd", unit_amount: order.price_cents,
                                                       product_data: { name: order.offer.name } } } },
      });
      const res = await fetchImpl(`${api}/v1/checkout/sessions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/x-www-form-urlencoded",
                   "Idempotency-Key": `checkout-${order.id}` },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.url) throw new Error(`stripe checkout unavailable (${res.status})`);
      return { method: "stripe", redirect: d.url, session: d.id };
    },

    /** Recover a pre-binding checkout only from this merchant's authenticated Stripe API. */
    async recoverCheckout(order, paid) {
      const s = await readSession(paid.session);
      // Both fields were set by the old checkout creator. Event metadata alone
      // is insufficient; the independently retrieved session must agree too.
      return matchesOrder(s, order, paid.session) && s.payment_status === "paid"
        && Number.isSafeInteger(s.amount_total) && s.amount_total === order.price_cents && s.amount_total === paid.amountCents
        && `stripe:${s.payment_intent}` === paid.ref
        && Number.isSafeInteger(s.created) && s.created >= Math.floor(order.created_ms / 1000) - 60;
    },

    /** Read the bound checkout to recover a missed webhook or confirm unpaid expiry. */
    async checkoutStatus(order) {
      if (!secretKey) throw new Error("stripe reconciliation unavailable");
      const id = order.checkout.session;
      const s = await readSession(id, { includeCharge: true });
      if (!matchesOrder(s, order, id)) throw new Error("stripe checkout terms mismatch");
      if (s.payment_status === "paid") {
        const intent = s.payment_intent;
        const charge = intent?.latest_charge;
        if (!Number.isSafeInteger(s.amount_total) || s.amount_total <= 0 || !intent?.id
            || !charge?.id || !Number.isSafeInteger(charge.amount_refunded))
          throw new Error("stripe checkout charge unavailable");
        const paid = { session: id, ref: `stripe:${intent.id}`, amountCents: s.amount_total };
        if (charge.refunded) return { status: "refunded", paid, refundedCents: charge.amount_refunded };
        if (charge.disputed || charge.amount_refunded > 0)
          return { status: "payment_review", paid, refundedCents: charge.amount_refunded };
        return { status: "paid", paid, refundedCents: 0 };
      }
      return {
        status: s.status === "expired" && s.payment_status === "unpaid" ? "expired" : "pending",
        redirect: s.status === "open" ? s.url : undefined,
      };
    },

    /** The webhook: {orderId, ref} for a paid checkout, null for anything else. */
    paidFromWebhook(rawBody, signatureHeader, opts) {
      const event = verifyWebhook(rawBody, signatureHeader, webhookSecret, opts);
      if (!event) return { error: "bad_signature" };
      if (["charge.refunded", "charge.dispute.created", "charge.dispute.closed",
        "refund.created", "refund.updated", "refund.failed"].includes(event.type)) {
        const intent = event.data?.object?.payment_intent;
        return typeof intent === "string" && intent.startsWith("pi_")
          ? { reversal: true, ref: `stripe:${intent}` } : null;
      }
      if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") return null;
      const s = event.data?.object || {};
      if (s.payment_status !== "paid") return null;
      if (s.mode !== "payment" || s.currency !== "usd" || !Number.isSafeInteger(s.amount_total) || s.amount_total < 1
          || typeof s.id !== "string" || !s.id || typeof s.payment_intent !== "string" || !s.payment_intent)
        return { error: "payment_terms_mismatch" };
      const orderId = s.client_reference_id || s.metadata?.order_id;
      if (s.client_reference_id && s.metadata?.order_id && s.client_reference_id !== s.metadata.order_id)
        return { error: "payment_order_mismatch" };
      return typeof orderId === "string" && orderId
        ? { orderId, session: s.id, ref: `stripe:${s.payment_intent}`, amountCents: s.amount_total } : null;
    },
  };
}
