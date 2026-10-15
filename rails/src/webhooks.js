// Events for the operator's own systems — CRM, billing, accounting, a chat channel: every order that
// changes status is POSTed to WEBHOOK_URL as JSON, signed so the receiver knows it came from the kit.
//
//   POST <url>   content-type: application/json
//   X-Kit-Event: order.delivered
//   X-Kit-Timestamp: 1765432100000                    (ms; refuse anything older than five minutes)
//   X-Kit-Signature: v1=<hex HMAC-SHA256(secret, timestamp + "." + body)>
//   body: {id, type, created_at, data}               (spec/esim-v1/webhook-event.schema.json)
//
// Storefront events: order.created, order.delivered, order.refund_due, order.underpaid,
// order.expired, order.awaiting_payment (a settlement failed and the order is open again).
// Seller-node events: agent_order.delivered, agent_order.cancelled.
// An event never carries an activation code, a QR link, an order token or a key. Delivery is at
// least once: three tries over about half a minute; the receiver dedupes by `id`.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const signWebhook = (secret, timestamp, body) =>
  `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;

/** For the receiving side (a JS receiver; the guides show the same in Python and Go). */
export function verifyWebhook({ secret, timestamp, signature, body, now = Date.now(), toleranceMs = 5 * 60_000 }) {
  if (!secret || !/^\d{10,16}$/.test(String(timestamp)) || Math.abs(now - Number(timestamp)) > toleranceMs) return false;
  const want = Buffer.from(signWebhook(secret, timestamp, body));
  const got = Buffer.from(String(signature || ""));
  return got.length === want.length && timingSafeEqual(got, want);
}

/** An emitter: emit(type, data) posts in the background and never throws into the order flow. */
export function createWebhooks({ url = "", secret = "", fetchImpl = globalThis.fetch, log = console,
                                 delaysMs = [1_000, 5_000, 25_000], now = () => Date.now(),
                                 sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  if (!url) return { enabled: false, emit() {}, async flush() {} };
  if (!/^https:\/\//.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url)) {
    throw new Error("WEBHOOK_URL must be https (or http to this machine)");
  }
  if (String(secret).length < 16) throw new Error("the webhook secret must be 16+ characters");
  const pending = new Set();

  async function send(event) {
    const body = JSON.stringify(event);
    for (let attempt = 0; ; attempt++) {
      const ts = String(now());
      try {
        const res = await fetchImpl(url, {
          method: "POST", body, signal: AbortSignal.timeout(10_000),
          headers: { "content-type": "application/json", "user-agent": "esim-kit-webhooks/1", "X-Kit-Event": event.type,
                     "X-Kit-Timestamp": ts, "X-Kit-Signature": signWebhook(secret, ts, body) },
        });
        if (res.ok) return true;
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
          log.warn?.(`webhook ${event.type} refused with HTTP ${res.status}; not retried`);
          return false;
        }
      } catch { /* the receiver is down: retry */ }
      if (attempt >= delaysMs.length) { log.warn?.(`webhook ${event.type} ${event.id} not delivered`); return false; }
      await sleep(delaysMs[attempt]);
    }
  }

  return {
    enabled: true,
    emit(type, data) {
      const event = { id: randomUUID(), type, created_at: new Date(now()).toISOString(), data };
      const p = send(event).catch(() => false).finally(() => pending.delete(p));
      pending.add(p);
    },
    /** Wait for what is in flight (tests, shutdown). */
    async flush() { await Promise.all([...pending]); },
  };
}
