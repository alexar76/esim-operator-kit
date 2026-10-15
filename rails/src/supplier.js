// Where the eSIMs come from. Everything above this line — the storefront, the seller node for agents,
// the order flow, the payments — talks to a supplier through these five methods only, so an operator
// with its own provisioning system plugs it in here and keeps the rest of the kit as it is.
//
//   catalog()                             → Plan[]      the plans you sell, at your cost
//   order({ transactionId, planId, costUsd }) → { orderRef }
//                                            one profile of one plan; idempotent by transactionId:
//                                            the same id again is the same order, never a second one
//   profiles({ orderRef } | { profileId })  → Profile[]  [] while the profile is still being made
//   cancel({ profileId })                   → true       an unused profile, refunded to you
//   balance()                               → { usd } | null   null when there is no balance to watch
//
//   Plan     { id, name, countries: ["FR", …], kind?: country|region|global, data_bytes, days,
//              speed?, networks?: [{country, operators: [{name, type}]}], top_up?, unused_valid_days?,
//              cost_usd }               cost_usd never leaves the node; buyers see your price
//   Profile  { profileId, orderRef, activationCode, iccid, qrCodeUrl?, installUrl?, apn?, expires?,
//              state?, installed?, dataUsedBytes?, dataTotalBytes?, activated? }
//
// A supplier throws SupplierError: `retryable` for "not now" (rate limit, an outage), plain for "no"
// (an unknown plan, a price that changed, an empty balance) — a "no" is never charged to the buyer.
//
// Two suppliers ship with the kit: eSIM Access (below) and HTTP (http-supplier.js), which calls five
// endpoints of the operator's own system.
import { PRICE_UNITS, SupplierError } from "./esimaccess.js";

export { SupplierError };

const ID = /^[A-Za-z0-9_.,-]{1,64}$/;

/** eSIM Access package → Plan. Day passes and non-USD plans are left out of v1. */
export function planFromEsimAccess(pkg) {
  if (String(pkg.dataType ?? "1") !== "1") return null;
  if (String(pkg.durationUnit || "DAY").toUpperCase() !== "DAY") return null;
  if (String(pkg.currencyCode || "USD").toUpperCase() !== "USD") return null;
  const id = String(pkg.slug || pkg.packageCode || "");
  const units = Number(pkg.price);
  if (!ID.test(id) || !Number.isInteger(units) || units <= 0 || !(pkg.volume > 0) || !(pkg.duration > 0)) return null;
  const countries = String(pkg.location || "").split(",").map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));
  return {
    id,
    name: String(pkg.name || id).slice(0, 120),
    countries,
    kind: countries.length > 1 ? (/^(GL|GLOBAL)/i.test(id) || countries.length > 60 ? "global" : "region") : "country",
    data_bytes: Number(pkg.volume),
    days: Number(pkg.duration),
    speed: String(pkg.speed || ""),
    networks: (Array.isArray(pkg.locationNetworkList) ? pkg.locationNetworkList : []).map((n) => ({
      country: String(n.locationName || ""),
      operators: (Array.isArray(n.operatorList) ? n.operatorList : [])
        .map((o) => ({ name: String(o.operatorName || ""), type: String(o.networkType || "") })).filter((o) => o.name),
    })),
    top_up: [2, 3].includes(Number(pkg.supportTopUpType)),
    unused_valid_days: Number(pkg.unusedValidTime) || null,
    cost_usd: units / PRICE_UNITS,
  };
}

/** eSIM Access profile → Profile. */
export function profileFromEsimAccess(p) {
  return {
    profileId: p.esimTranNo, orderRef: p.orderNo, activationCode: p.ac || null, iccid: p.iccid || null,
    qrCodeUrl: p.qrCodeUrl || null, installUrl: p.shortUrl || null, apn: p.apn || null, expires: p.expiredTime || null,
    state: p.esimStatus || null, installed: p.smdpStatus === "ENABLED" || p.smdpStatus === "DISABLED",
    dataUsedBytes: Number(p.orderUsage) || 0, dataTotalBytes: Number(p.totalVolume) || null, activated: p.activateTime || null,
  };
}

/** The eSIM Access client (esimaccess.js createClient) as a supplier. */
export function esimAccessSupplier(client) {
  return {
    kind: "esimaccess",
    client,
    async catalog() { return (await client.packages()).map(planFromEsimAccess).filter(Boolean); },
    async order({ transactionId, planId, costUsd }) {
      // The cost the plan was quoted at goes with the order: a plan whose price moved since is refused, not charged.
      const r = await client.order({ transactionId, slug: planId, priceUnits: Number.isFinite(costUsd) ? Math.round(costUsd * PRICE_UNITS) : undefined });
      return { orderRef: r.orderNo };
    },
    async profiles({ orderRef, profileId }) {
      return (await client.profiles({ orderNo: orderRef, esimTranNo: profileId })).map(profileFromEsimAccess);
    },
    async cancel({ profileId }) { return client.cancel({ esimTranNo: profileId }); },
    async balance() { const b = await client.balance(); return { usd: b.units / PRICE_UNITS }; },
  };
}

/** A supplier from whatever was configured: a Supplier as it is, an eSIM Access client wrapped. */
export function asSupplier(x) {
  if (!x) throw new Error("no supplier configured");
  if (typeof x.catalog === "function" || x.kind) return x;
  // eSIM Access's own client (or a stand-in for it): packages(), order({slug}), profiles({orderNo}).
  if (typeof x.packages === "function" || typeof x.order === "function" || typeof x.profiles === "function") return esimAccessSupplier(x);
  throw new Error("a supplier needs catalog(), order(), profiles(), cancel() and balance()");
}
