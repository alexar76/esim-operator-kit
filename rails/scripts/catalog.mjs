#!/usr/bin/env node
// Read-only look at a seller's catalogue at the seller's prices: the balance, how many plans, what each
// line of the price list did, and the top offers for a few countries with the wholesale cost beside each.
// Orders nothing, spends nothing. Reads the same environment as the store and the node (SUPPLIER,
// MARGIN_PCT, MIN_MARGIN_USD, PRICES_FILE).
//
//   docker compose exec -T rails node scripts/catalog.mjs [FR ES JP …]
import { pricingFromEnv, supplierFromEnv } from "../src/config.js";
import { offersFromPlans, planShape, quote } from "../src/offers.js";
import { ruleFor } from "../src/prices.js";

const groupBy = (xs, key) => xs.reduce((m, x) => ((m[key(x)] ||= []).push(x), m), {});   // Node 20 has no Object.groupBy
const countries = process.argv.slice(2).filter((c) => /^[A-Za-z]{2}$/.test(c));
const supplier = supplierFromEnv(process.env);
const pricing = pricingFromEnv(process.env);

const bal = await supplier.balance();
console.log(`balance: ${bal ? `$${Number(bal.usd).toFixed(2)}` : "not reported by this supplier"}`);
const plans = await supplier.catalog();
const offers = offersFromPlans(plans, pricing);
const kinds = Object.entries(groupBy(offers, (o) => o.coverage.kind)).map(([k, v]) => `${v.length} ${k}`).join(", ");
console.log(`plans: ${plans.length}; offered: ${offers.length} (${kinds || "none"})`);
console.log(`formula: cost + ${pricing.marginPct} %, at least cost + $${Number(pricing.minMarginUsd).toFixed(2)}`);

if (pricing.rules) {
  // What every line of the list did: a line that priced nothing is usually a typo or a withdrawn plan.
  const priced = groupBy(offers.filter((o) => o._price_rule), (o) => o._price_rule);
  const shapes = plans.map(planShape).filter(Boolean);
  console.log(`\nprice list ${pricing.file}: ${pricing.rules.length} rules`);
  for (const r of [...pricing.rules].sort((a, b) => a.order - b.order)) {
    const mine = priced[r.label] || [];
    const below = mine.filter((o) => o._below_cost).length;
    const what = r.off ? "off" : r.fixedCents !== null ? `$${(r.fixedCents / 100).toFixed(2)}`
      : `${r.marginPct ?? pricing.marginPct} %, at least $${Number(r.minMarginUsd ?? pricing.minMarginUsd).toFixed(2)}`;
    const n = r.off ? shapes.filter((p) => ruleFor(pricing.rules, p) === r).length : mine.length;
    const note = !n ? "  ← picks no plan: check the id, the country or the size"
      : below ? `  ← ${below} below cost: priced by the formula until you change it` : "";
    console.log(`  ${r.where.split(", ").pop().padEnd(9)} ${r.label.padEnd(24)} ${what.padEnd(26)} ${n} plan${n === 1 ? "" : "s"}${r.off ? " not offered" : ""}${note}`);
  }
}

for (const cc of countries.length ? countries : ["FR", "ES", "US", "JP", "TH"]) {
  const top = quote(offers, { country: cc, limit: 5 });
  console.log(`\n${cc.toUpperCase()}: ${top.length ? "" : "no plan"}`);
  for (const o of top) {
    const full = offers.find((x) => x.offer_id === o.offer_id);
    console.log(`  ${o.offer_id.padEnd(22)} ${String(o.data_gb).padStart(5)} GB ${String(o.days).padStart(3)} d  `
      + `$${o.price.usd.padStart(6)} (wholesale $${full._cost_usd.toFixed(2)})  ${o.coverage.kind}${o.coverage.kind === "country" ? "" : ` ×${o.coverage.countries.length}`}`
      + `${full._price_rule ? `  [${full._price_rule}]` : ""}`);
  }
}
