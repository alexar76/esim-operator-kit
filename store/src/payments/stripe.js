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
  const ok = signatures.some((s) => s.length === want.length && timingSafeEqual(Buffer.from(s), Buffer.from(want)));
  if (!ok) return null;
  try { return JSON.parse(rawBody); } catch { return null; }
}

export function stripeCards({ secretKey = "", webhookSecret = "", publicUrl = "", fetchImpl = globalThis.fetch,
                              api = "https://api.stripe.com" }) {
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
        signal: AbortSignal.timeout(20_000),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.url) throw new Error(`stripe: ${d?.error?.message || res.status}`);
      return { method: "stripe", redirect: d.url, session: d.id };
    },

    /** The webhook: {orderId, ref} for a paid checkout, null for anything else. */
    paidFromWebhook(rawBody, signatureHeader, opts) {
      const event = verifyWebhook(rawBody, signatureHeader, webhookSecret, opts);
      if (!event) return { error: "bad_signature" };
      if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") return null;
      const s = event.data?.object || {};
      if (s.payment_status !== "paid") return null;
      const orderId = s.client_reference_id || s.metadata?.order_id;
      return orderId ? { orderId, ref: `stripe:${s.payment_intent || s.id}`, amountCents: s.amount_total } : null;
    },
  };
}
