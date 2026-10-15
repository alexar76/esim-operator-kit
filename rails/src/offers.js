// A supplier's data plans as esim offers: the shape every seller node answers esim.quote@v1 with,
// whichever supplier it buys from (spec/esim-v1/offer.schema.json). A buyer compares offers across
// sellers on these fields only.
//
//   offer_id   the seller's id for the plan (eSIM Access: its slug), what esim.order@v1 takes
//   coverage   {kind: country | region | global, countries: ISO alpha-2[]}
//   data_bytes / data_gb, days, speed, networks, top_up, unused_valid_days
//   price      {usd: "4.80", currency: "USDC"} — the seller's price; the supplier's cost never leaves the node
//   usd_per_gb the price per GiB, for comparing plans of different sizes
import { ruleFor } from "./prices.js";
import { planFromEsimAccess } from "./supplier.js";

const GIB = 1024 ** 3;
const ID = /^[A-Za-z0-9_.,-]{1,64}$/;

/** The margin when MARGIN_PCT and MIN_MARGIN_USD are not set: the price doubles, and at least $1 is added. */
export const DEFAULT_PRICING = Object.freeze({ marginPct: 100, minMarginUsd: 1 });

/** The seller's price in cents: cost plus a margin, never below cost plus a floor, rounded up. */
export function priceCents(costUsd, { marginPct = DEFAULT_PRICING.marginPct, minMarginUsd = DEFAULT_PRICING.minMarginUsd } = {}) {
  const cost = Number(costUsd);
  if (!Number.isFinite(cost) || cost <= 0) return null;
  const target = Math.max(cost * (1 + marginPct / 100), cost + minMarginUsd);
  return Math.ceil(Math.round(target * 1e6) / 1e4);   // cents, rounded up after taming float noise
}

/**
 * A plan's price under `pricing` ({marginPct, minMarginUsd, rules}): the rule of the price list that
 * picks it (prices.js), else the formula. → {cents, rule, belowCost} — cents null: not offered.
 */
export function priceFor(plan, pricing = {}) {
  const base = { marginPct: pricing.marginPct ?? DEFAULT_PRICING.marginPct, minMarginUsd: pricing.minMarginUsd ?? DEFAULT_PRICING.minMarginUsd };
  const rule = ruleFor(pricing.rules, plan);
  const cost = Number(plan.cost_usd);
  if (!rule) return { cents: priceCents(cost, base), rule: null, belowCost: false };
  if (rule.off) return { cents: null, rule, belowCost: false };
  if (rule.fixedCents !== null) {
    // A list written last month must not sell at a loss this month: below cost, the formula prices it.
    return cost > 0 && rule.fixedCents >= Math.ceil(Math.round(cost * 1e6) / 1e4)   // the cost in cents, rounded up
      ? { cents: rule.fixedCents, rule, belowCost: false }
      : { cents: priceCents(cost, base), rule, belowCost: cost > 0 };
  }
  return { cents: priceCents(cost, { marginPct: rule.marginPct ?? base.marginPct, minMarginUsd: rule.minMarginUsd ?? base.minMarginUsd }),
           rule, belowCost: false };
}

export const usd = (cents) => (cents / 100).toFixed(2);

/** What offers and price rules read of a plan: {id, kind, countries, data_bytes, data_gb, days, cost_usd}, or null when it does not read right. */
export function planShape(p) {
  const countries = (Array.isArray(p?.countries) ? p.countries : []).map((c) => String(c).toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));
  const bytes = Number(p?.data_bytes), days = Number(p?.days), cost = Number(p?.cost_usd);
  if (!ID.test(String(p?.id ?? "")) || !countries.length || !(bytes > 0) || !(days > 0) || !(cost > 0)) return null;
  const kind = ["country", "region", "global"].includes(p.kind) ? p.kind : countries.length > 1 ? "region" : "country";
  return { id: String(p.id), kind, countries, data_bytes: bytes, data_gb: Math.round((bytes / GIB) * 100) / 100, days, cost_usd: cost };
}

/**
 * A supplier's plans (supplier.js Plan) → offers at the seller's prices. `pricing`: {marginPct,
 * minMarginUsd, rules} (rules from a price list, prices.js). A plan that does not read right, or that
 * the price list turns off, is left out.
 */
export function offersFromPlans(plans, pricing = {}) {
  const out = [];
  for (const p of plans || []) {
    const shape = planShape(p);
    if (!shape) continue;
    const { kind, countries, data_bytes: bytes, data_gb: dataGb, days } = shape;
    const { cents, rule, belowCost } = priceFor(shape, pricing);
    if (cents === null) continue;
    out.push({
      offer_id: String(p.id),
      name: String(p.name || p.id).slice(0, 120),
      coverage: { kind, countries },
      data_bytes: bytes,
      data_gb: dataGb,
      days,
      speed: String(p.speed || ""),
      networks: Array.isArray(p.networks) ? p.networks : [],
      top_up: Boolean(p.top_up),
      unused_valid_days: Number(p.unused_valid_days) || null,
      price: { usd: usd(cents), currency: "USDC" },
      // For comparing a 1 GB plan with a 10 GB one: the cheapest offer is often a 0.1 GB test plan.
      usd_per_gb: Math.round((cents / 100 / (bytes / GIB)) * 100) / 100,
      _cost_usd: Number(p.cost_usd),               // kept inside the node: the order carries it to the supplier
      _price_rule: rule ? rule.label : null,        // which line of the price list priced it (scripts/catalog.mjs)
      ...(belowCost ? { _below_cost: true } : {}),
    });
  }
  return out;
}

/** eSIM Access packages → offers (the eSIM Access supplier's catalogue, priced). */
export const offersFromEsimAccess = (packages, pricing = {}) =>
  offersFromPlans((packages || []).map(planFromEsimAccess).filter(Boolean), pricing);

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
