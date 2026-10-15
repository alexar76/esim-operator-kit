// Ready supplier adapters for two more wholesale platforms an existing operator may already buy
// from. Both were written against the platforms' published API references (read 2026-10-14) and
// tested against responses shaped like their documented examples; neither has run against a live
// account of the kit's authors yet — run `scripts/catalog.mjs` and one cancelled test order first.
//
//   Airalo Partner API   SUPPLIER=airalo   AIRALO_CLIENT_ID_FILE, AIRALO_CLIENT_SECRET_FILE[, AIRALO_BASE_URL]
//   eSIM Go API v2.5     SUPPLIER=esimgo   ESIMGO_API_KEY_FILE[, ESIMGO_BASE_URL]
//
// Neither platform takes an idempotency key on its orders, so each adapter remembers the orders it
// placed by transactionId (in memory, and through the node's order store, which keeps the order
// reference before the profile is fetched): a retry of the same payment does not buy twice while
// the process lives. Each also refuses an order whose cost no longer matches its last catalogue.
import { SupplierError } from "./supplier.js";

const MIB = 1024 * 1024;
const iso2 = (c) => String(c || "").toUpperCase();
const isIso2 = (c) => /^[A-Z]{2}$/.test(c);

function guard() {
  const placed = new Map();          // transactionId → Promise<{orderRef}>
  const costs = new Map();           // planId → cost_usd from the last catalogue
  return {
    remember(plans) { costs.clear(); for (const p of plans) costs.set(p.id, p.cost_usd); return plans; },
    checkCost(planId, costUsd) {
      if (!costs.has(planId)) throw new SupplierError("unknown_plan", "the plan is not in the catalogue");
      if (Number.isFinite(costUsd) && Math.abs(costs.get(planId) - costUsd) > 1e-9) {
        throw new SupplierError("price_changed", "the plan's cost changed since the quote");
      }
    },
    once(transactionId, place) {
      if (!placed.has(transactionId)) {
        const p = place().catch((err) => { placed.delete(transactionId); throw err; });
        placed.set(transactionId, p);
      }
      return placed.get(transactionId);
    },
  };
}

async function readJson(res) { try { return await res.json(); } catch { return null; } }
function failure(res, doc, what) {
  const msg = typeof doc?.meta?.message === "string" ? doc.meta.message : typeof doc?.message === "string" ? doc.message : `HTTP ${res.status}`;
  return new SupplierError(`${what}_${res.status}`, msg.slice(0, 200), { status: res.status, retryable: res.status === 429 || res.status >= 500 });
}

// ── Airalo ───────────────────────────────────────────────────────────────────────────────────────
// POST /v2/token (form: client_id, client_secret, grant_type=client_credentials) → data.access_token
// GET  /v2/packages → data[] (country) → operators[] → packages[] {id, type, net_price, amount (MB), day, is_unlimited}
// POST /v2/orders (multipart: quantity, package_id, type=sim, description) → data {id, code, sims[] {iccid, lpa, matching_id, qrcode, qrcode_url, direct_apple_installation_url, apn_value}}
// GET  /v2/sims/{iccid} → data {…the sim, simable: the order}; GET /v2/sims/{iccid}/usage → data {remaining, total (MB), expired_at, status}
// POST /v2/refund (multipart: iccids[], reason, notes) → 202; reviewed by Airalo, credited as Airalo credit
export function airaloSupplier({ clientId, clientSecret, base = "https://partners-api.airalo.com", fetchImpl = globalThis.fetch,
                                 now = () => Date.now(), timeoutMs = 30_000 }) {
  if (!clientId || !clientSecret) throw new Error("Airalo needs a client id and a client secret");
  const root = base.replace(/\/+$/, "");
  const g = guard();
  const byOrder = new Map();         // order id → sims from the order answer
  let token = null;

  async function auth() {
    if (token && token.until > now() + 60_000) return token.value;
    const res = await fetchImpl(`${root}/v2/token`, {
      method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }).toString(),
      signal: AbortSignal.timeout(timeoutMs),
    }).catch(() => { throw new SupplierError("unreachable", "Airalo did not answer", { retryable: true }); });
    const doc = await readJson(res);
    if (!res.ok || !doc?.data?.access_token) throw failure(res, doc, "airalo_token");
    // Airalo allows 3 token requests a minute: the token is kept until shortly before it expires.
    token = { value: doc.data.access_token, until: now() + Math.min(Number(doc.data.expires_in) || 86_400, 86_400) * 1000 };
    return token.value;
  }
  async function call(method, path, form) {
    const headers = { accept: "application/json", authorization: `Bearer ${await auth()}` };
    let body;
    if (form) { body = new FormData(); for (const [k, v] of Object.entries(form)) [].concat(v).forEach((x) => body.append(k, String(x))); }
    const res = await fetchImpl(`${root}${path}`, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) })
      .catch(() => { throw new SupplierError("unreachable", "Airalo did not answer", { retryable: true }); });
    const doc = await readJson(res);
    if (!res.ok) throw failure(res, doc, "airalo");
    return doc?.data;
  }
  const profileOf = (sim, extra = {}) => ({
    profileId: String(sim.iccid), orderRef: extra.orderRef ?? (sim.simable?.id != null ? String(sim.simable.id) : null),
    activationCode: sim.qrcode || (sim.lpa && sim.matching_id ? `LPA:1$${sim.lpa}$${sim.matching_id}` : null),
    iccid: String(sim.iccid), qrCodeUrl: sim.qrcode_url || null, installUrl: sim.direct_apple_installation_url || null,
    apn: sim.apn_value || null, ...extra.usage,
  });

  return {
    kind: "airalo",
    async catalog() {
      const data = await call("GET", "/v2/packages");
      const plans = [];
      for (const place of Array.isArray(data) ? data : []) {
        for (const op of place.operators || []) {
          const countries = (op.countries?.length ? op.countries.map((c) => iso2(c.country_code)) : [iso2(place.country_code)]).filter(isIso2);
          if (!countries.length) continue;
          const networks = (op.coverages || []).map((c) => ({ country: String(c.name || c.code || ""),
            operators: (c.networks || []).map((n) => ({ name: String(n.name || ""), type: [].concat(n.types || []).join("/") })) }));
          for (const pkg of op.packages || []) {
            if (pkg.type !== "sim" || pkg.is_unlimited || !(pkg.amount > 0) || !(pkg.day > 0)) continue;
            const cost = Number(pkg.prices?.net_price?.USD ?? pkg.net_price);
            if (!(cost > 0)) continue;
            plans.push({ id: String(pkg.id), name: `${place.title || op.title} ${pkg.title || ""}`.trim().slice(0, 120), countries,
              kind: countries.length > 60 ? "global" : countries.length > 1 ? "region" : "country",
              data_bytes: Math.round(Number(pkg.amount) * MIB), days: Number(pkg.day), speed: "", networks,
              top_up: Boolean(op.rechargeability), unused_valid_days: Number(op.install_window_days) || null, cost_usd: cost });
          }
        }
      }
      return g.remember(plans);
    },
    async order({ transactionId, planId, costUsd }) {
      g.checkCost(planId, costUsd);
      return g.once(transactionId, async () => {
        const d = await call("POST", "/v2/orders", { quantity: 1, package_id: planId, type: "sim", description: transactionId });
        const orderRef = String(d?.id ?? d?.code ?? "");
        if (!orderRef) throw new SupplierError("bad_answer", "Airalo's order answer has no id", { retryable: true });
        byOrder.set(orderRef, (d.sims || []).map((s) => profileOf(s, { orderRef })));
        return { orderRef };
      });
    },
    async profiles({ orderRef, profileId }) {
      if (orderRef) return byOrder.get(String(orderRef)) ?? [];
      const sim = await call("GET", `/v2/sims/${encodeURIComponent(profileId)}?include=order`);
      if (!sim?.iccid) return [];
      let usage = {};
      try {
        const u = await call("GET", `/v2/sims/${encodeURIComponent(profileId)}/usage`);
        usage = { state: u.status ?? null, installed: u.status && u.status !== "NOT_ACTIVE", expires: u.expired_at ?? null,
                  dataTotalBytes: u.is_unlimited ? null : Math.round(Number(u.total) * MIB),
                  dataUsedBytes: u.is_unlimited ? 0 : Math.max(0, Math.round((Number(u.total) - Number(u.remaining)) * MIB)) };
      } catch { /* usage is rate limited: the profile still answers */ }
      return [profileOf(sim, { usage })];
    },
    async cancel({ profileId }) {
      await call("POST", "/v2/refund", { "iccids[]": [profileId], reason: "OTHERS", notes: "Unused: the buyer's payment did not settle." });
      return true;
    },
    async balance() { return null; },   // not checked: keep the Airalo account funded
  };
}

// ── eSIM Go ──────────────────────────────────────────────────────────────────────────────────────
// X-API-Key header. GET /catalogue?page&perPage → bundles {name, description, countries[{iso}], dataAmount (MB), duration, speed[], unlimited, price}
// POST /orders {type: "transaction", assign: true, order: [{type: "bundle", quantity: 1, item, allowReassign: false}]}
//   → {orderReference, order[{esims[{iccid, matchingId, smdpAddress}]}]}
// GET /esims/{iccid} → {iccid, matchingId, smdpAddress, appleInstallUrl, firstInstalledDateTime, state}
// GET /esims/{iccid}/bundles → bundles[{name, assignments[{id, initialQuantity, remainingQuantity (bytes), bundleState, startTime, endTime}]}]
// DELETE /esims/{iccid}/bundles/{name}?refundToBalance=true&offerId=…  (refunds must be enabled by eSIM Go)
export function esimGoSupplier({ apiKey, base = "https://api.esim-go.com/v2.5", fetchImpl = globalThis.fetch, timeoutMs = 30_000, perPage = 200 }) {
  if (!apiKey) throw new Error("eSIM Go needs an API key");
  const root = base.replace(/\/+$/, "");
  const g = guard();
  const byOrder = new Map();
  async function call(method, path, json) {
    const res = await fetchImpl(`${root}${path}`, {
      method, headers: { "X-API-Key": apiKey, accept: "application/json", ...(json ? { "content-type": "application/json" } : {}) },
      body: json ? JSON.stringify(json) : undefined, signal: AbortSignal.timeout(timeoutMs),
    }).catch(() => { throw new SupplierError("unreachable", "eSIM Go did not answer", { retryable: true }); });
    const doc = await readJson(res);
    if (!res.ok) throw failure(res, doc, "esimgo");
    return doc;
  }
  const code = (smdp, matching) => (smdp && matching ? `LPA:1$${smdp}$${matching}` : null);

  return {
    kind: "esimgo",
    async catalog() {
      const plans = [];
      for (let page = 1; page <= 100; page++) {
        const d = await call("GET", `/catalogue?page=${page}&perPage=${perPage}`);
        const bundles = Array.isArray(d) ? d : Array.isArray(d?.bundles) ? d.bundles : [];
        for (const b of bundles) {
          const countries = (b.countries || []).map((c) => iso2(c.iso)).filter(isIso2);
          if (b.unlimited || !countries.length || !(b.dataAmount > 0) || !(b.duration > 0) || !(Number(b.price) > 0)) continue;
          plans.push({ id: String(b.name), name: String(b.description || b.name).slice(0, 120), countries,
            kind: countries.length > 60 ? "global" : countries.length > 1 ? "region" : "country",
            data_bytes: Math.round(Number(b.dataAmount) * MIB), days: Number(b.duration),
            speed: [].concat(b.speed || []).join("/"), networks: [], top_up: true, unused_valid_days: null, cost_usd: Number(b.price) });
        }
        const pages = Number(d?.pageCount);
        if (bundles.length < perPage || (pages && page >= pages)) break;
      }
      return g.remember(plans);
    },
    async order({ transactionId, planId, costUsd }) {
      g.checkCost(planId, costUsd);
      return g.once(transactionId, async () => {
        const d = await call("POST", "/orders", { type: "transaction", assign: true,
          order: [{ type: "bundle", quantity: 1, item: planId, allowReassign: false }] });
        const orderRef = String(d?.orderReference || "");
        if (!orderRef) throw new SupplierError("bad_answer", "eSIM Go's order answer has no orderReference", { retryable: true });
        const esims = (d.order || []).flatMap((o) => o.esims || []);
        byOrder.set(orderRef, esims.map((e) => ({ profileId: String(e.iccid), orderRef, iccid: String(e.iccid),
          activationCode: code(e.smdpAddress, e.matchingId) })));
        return { orderRef };
      });
    },
    async profiles({ orderRef, profileId }) {
      if (orderRef) return byOrder.get(String(orderRef)) ?? [];
      const e = await call("GET", `/esims/${encodeURIComponent(profileId)}`);
      if (!e?.iccid) return [];
      let a = null;
      try { a = (await call("GET", `/esims/${encodeURIComponent(profileId)}/bundles`))?.bundles?.[0]?.assignments?.[0] ?? null; } catch { a = null; }
      const total = Number(a?.initialQuantity), left = Number(a?.remainingQuantity);
      return [{ profileId: String(e.iccid), orderRef: null, iccid: String(e.iccid), activationCode: code(e.smdpAddress, e.matchingId),
        installUrl: e.appleInstallUrl || null, state: a?.bundleState ?? e.state ?? null, installed: Boolean(e.firstInstalledDateTime),
        dataTotalBytes: Number.isFinite(total) ? total : null, dataUsedBytes: Number.isFinite(total) && Number.isFinite(left) ? Math.max(0, total - left) : 0,
        activated: a?.startTime ?? null, expires: a?.endTime ?? null }];
    },
    async cancel({ profileId }) {
      const b = (await call("GET", `/esims/${encodeURIComponent(profileId)}/bundles`))?.bundles?.[0];
      if (!b?.name) throw new SupplierError("not_found", "no bundle on this eSIM");
      const offer = b.assignments?.[0]?.id;
      await call("DELETE", `/esims/${encodeURIComponent(profileId)}/bundles/${encodeURIComponent(b.name)}?type=transaction&refundToBalance=true${offer ? `&offerId=${encodeURIComponent(offer)}` : ""}`);
      return true;
    },
    async balance() { return null; },   // not checked: keep the eSIM Go balance funded
  };
}
