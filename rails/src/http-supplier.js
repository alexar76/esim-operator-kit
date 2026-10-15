// The operator's own system as the supplier: five endpoints under SUPPLIER_URL, in any language,
// and the kit does the rest — storefront, agents, payments, the federation. The contract is in
// spec/supplier-http.md and spec/esim-v1/supplier-*.schema.json; examples/operator-backend.mjs is a
// working reference to copy.
//
//   GET  /catalog                         → {plans: [Plan]}
//   POST /orders  {transaction_id, plan_id, cost_usd}
//                                         → {order_ref}          idempotent by transaction_id
//   GET  /profiles?order_ref=… | ?profile_id=…
//                                         → {profiles: [Profile]} [] while the profile is being made
//   POST /profiles/{profile_id}/cancel    → {cancelled: true}
//   GET  /balance                         → {usd} — or 404 when there is no balance to watch
//
// Every request is signed with the shared secret, so the operator's system can refuse anyone else:
//   X-Kit-Timestamp: <ms>
//   X-Kit-Signature: v1=<hex HMAC-SHA256(secret, timestamp + "." + METHOD + " " + path?query + "." + body)>
// An error answer is {error, message?, retryable?}: retryable (or HTTP 429/5xx) means "not now",
// anything else "no" — a "no" is never charged to the buyer.
import { createHmac, timingSafeEqual } from "node:crypto";
import { SupplierError } from "./supplier.js";

export const signSupplierRequest = (secret, timestamp, method, path, body = "") =>
  `v1=${createHmac("sha256", secret).update(`${timestamp}.${method.toUpperCase()} ${path}.${body}`).digest("hex")}`;

/** For the operator's side (JS); spec/supplier-http.md shows Python and Go. `path` includes the query string. */
export function verifySupplierRequest({ secret, timestamp, signature, method, path, body = "", now = Date.now(), toleranceMs = 5 * 60_000 }) {
  if (!secret || !/^\d{10,16}$/.test(String(timestamp)) || Math.abs(now - Number(timestamp)) > toleranceMs) return false;
  const want = Buffer.from(signSupplierRequest(secret, timestamp, method, path, body));
  const got = Buffer.from(String(signature || ""));
  return got.length === want.length && timingSafeEqual(got, want);
}

const profileOf = (p) => ({
  profileId: String(p.profile_id ?? ""), orderRef: p.order_ref ?? null, activationCode: p.activation_code ?? null,
  iccid: p.iccid ?? null, qrCodeUrl: p.qr_code_url ?? null, installUrl: p.install_url ?? null, apn: p.apn ?? null,
  expires: p.expires ?? null, state: p.state ?? null, installed: Boolean(p.installed),
  dataUsedBytes: Number(p.data_used_bytes) || 0, dataTotalBytes: Number(p.data_total_bytes) || null, activated: p.activated ?? null,
});

export function httpSupplier({ url, secret, fetchImpl = globalThis.fetch, timeoutMs = 20_000, now = () => Date.now() }) {
  const base = new URL(String(url || ""));
  if (!/^https?:$/.test(base.protocol)) throw new Error("SUPPLIER_URL must be an http(s) URL");
  if (String(secret || "").length < 16) throw new Error("the supplier secret must be 16+ characters");
  const prefix = base.pathname.replace(/\/+$/, "");

  async function call(method, path, payload) {
    const body = payload === undefined ? "" : JSON.stringify(payload);
    const full = `${prefix}${path}`;
    const ts = String(now());
    let res;
    try {
      res = await fetchImpl(new URL(full, base).href, {
        method, body: body || undefined, signal: AbortSignal.timeout(timeoutMs),
        headers: { ...(body ? { "content-type": "application/json" } : {}), "user-agent": "esim-kit/1",
                   "X-Kit-Timestamp": ts, "X-Kit-Signature": signSupplierRequest(secret, ts, method, full, body) },
      });
    } catch {
      throw new SupplierError("unreachable", "the supplier did not answer", { retryable: true });
    }
    let doc = null;
    try { doc = await res.json(); } catch { doc = null; }
    if (!res.ok) {
      if (res.status === 404 && path === "/balance") return null;
      const code = String(doc?.error || `http_${res.status}`).slice(0, 40);
      throw new SupplierError(code, String(doc?.message || `the supplier answered HTTP ${res.status}`).slice(0, 200),
                              { status: res.status, retryable: doc?.retryable === true || res.status === 429 || res.status >= 500 });
    }
    if (!doc || typeof doc !== "object") throw new SupplierError("bad_answer", "the supplier answered without JSON", { retryable: true });
    return doc;
  }

  return {
    kind: "http",
    async catalog() { const d = await call("GET", "/catalog"); return Array.isArray(d.plans) ? d.plans : []; },
    async order({ transactionId, planId, costUsd }) {
      const d = await call("POST", "/orders", { transaction_id: transactionId, plan_id: planId, cost_usd: costUsd ?? null });
      if (!d.order_ref) throw new SupplierError("bad_answer", "the supplier's order answer has no order_ref", { retryable: true });
      return { orderRef: String(d.order_ref) };
    },
    async profiles({ orderRef, profileId }) {
      const q = orderRef ? `order_ref=${encodeURIComponent(orderRef)}` : `profile_id=${encodeURIComponent(profileId)}`;
      const d = await call("GET", `/profiles?${q}`);
      return (Array.isArray(d.profiles) ? d.profiles : []).map(profileOf).filter((p) => p.profileId);
    },
    async cancel({ profileId }) {
      await call("POST", `/profiles/${encodeURIComponent(profileId)}/cancel`, {});
      return true;
    },
    async balance() {
      const d = await call("GET", "/balance");
      return d === null ? null : { usd: Number(d.usd) };
    },
  };
}
