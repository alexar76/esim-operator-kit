// A supplier's data plans as esim offers: the shape every seller node answers esim.quote@v1 with,
// whichever wholesaler it buys from. A buyer compares offers across sellers on these fields only.
//
//   offer_id   the seller's id for the plan (eSIM Access: its slug), what esim.order@v1 takes
//   coverage   {kind: country | region | global, countries: ISO alpha-2[]}
//   data_bytes / data_gb, days, speed, networks, top_up, unused_valid_days
//   price      {usd: "4.80", currency: "USDC"} — the seller's price; the wholesale cost never leaves the node
//   usd_per_gb the price per GiB, for comparing plans of different sizes
import { PRICE_UNITS } from "./esimaccess.js";

const GIB = 1024 ** 3;

/** The seller's price in cents: wholesale plus a margin, never below wholesale plus a floor, rounded up. */
export function priceCents(wholesaleUnits, { marginPct = 20, minMarginUsd = 0.3 } = {}) {
  if (!Number.isInteger(wholesaleUnits) || wholesaleUnits <= 0) return null;
  const cost = wholesaleUnits / PRICE_UNITS;
  const target = Math.max(cost * (1 + marginPct / 100), cost + minMarginUsd);
  return Math.ceil(Math.round(target * 1e6) / 1e4);   // cents, rounded up after taming float noise
}

export const usd = (cents) => (cents / 100).toFixed(2);

function coverage(pkg) {
  const codes = String(pkg.location || "").split(",").map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));
  const slug = String(pkg.slug || pkg.packageCode || "");
  const kind = codes.length > 1 ? (/^(GL|GLOBAL)/i.test(slug) || codes.length > 60 ? "global" : "region") : "country";
  return { kind, countries: codes };
}

function networks(pkg) {
  return (Array.isArray(pkg.locationNetworkList) ? pkg.locationNetworkList : []).map((n) => ({
    country: String(n.locationName || ""),
    operators: (Array.isArray(n.operatorList) ? n.operatorList : [])
      .map((o) => ({ name: String(o.operatorName || ""), type: String(o.networkType || "") }))
      .filter((o) => o.name),
  }));
}

/** eSIM Access packages → offers. Day passes (dataType 2) are left out of v1: their price depends on days bought. */
export function offersFromEsimAccess(packages, pricing = {}) {
  const out = [];
  for (const pkg of packages || []) {
    if (String(pkg.dataType ?? "1") !== "1") continue;
    if (String(pkg.durationUnit || "DAY").toUpperCase() !== "DAY") continue;
    if (String(pkg.currencyCode || "USD").toUpperCase() !== "USD") continue;
    const cents = priceCents(Number(pkg.price), pricing);
    const id = String(pkg.slug || pkg.packageCode || "");
    if (cents === null || !/^[A-Za-z0-9_.,-]{1,64}$/.test(id) || !(pkg.volume > 0) || !(pkg.duration > 0)) continue;
    out.push({
      offer_id: id,
      name: String(pkg.name || id).slice(0, 120),
      coverage: coverage(pkg),
      data_bytes: Number(pkg.volume),
      data_gb: Math.round((Number(pkg.volume) / GIB) * 100) / 100,
      days: Number(pkg.duration),
      speed: String(pkg.speed || ""),
      networks: networks(pkg),
      top_up: [2, 3].includes(Number(pkg.supportTopUpType)),
      unused_valid_days: Number(pkg.unusedValidTime) || null,
      price: { usd: usd(cents), currency: "USDC" },
      // For comparing a 1 GB plan with a 10 GB one: the cheapest offer is often a 0.1 GB test plan.
      usd_per_gb: Math.round((cents / 100 / (Number(pkg.volume) / GIB)) * 100) / 100,
      _wholesale_units: Number(pkg.price),        // kept inside the node for the order's price check
    });
  }
  return out;
}

/** What a buyer sees: an offer without the node's private fields. */
export const publicOffer = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("_")));

/**
 * esim.quote@v1: the offers that cover a country, cheapest first. A regional or global plan that
 * includes the country is an offer for it too, ranked on the same terms.
 */
export function quote(offers, { country, min_gb = 0, min_days = 0, max_usd = Infinity, limit = 10 } = {}) {
  const cc = String(country || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) throw new TypeError("country must be an ISO 3166-1 alpha-2 code, e.g. FR");
  return offers
    .filter((o) => o.coverage.countries.includes(cc) && o.data_gb >= Number(min_gb || 0)
            && o.days >= Number(min_days || 0) && Number(o.price.usd) <= Number(max_usd ?? Infinity))
    .sort((a, b) => Number(a.price.usd) - Number(b.price.usd) || b.data_bytes - a.data_bytes || b.days - a.days
            || (a.coverage.kind === "country" ? -1 : 1))
    .slice(0, Math.max(1, Math.min(Number(limit) || 10, 50)))
    .map(publicOffer);
}
