#!/usr/bin/env node
// Read-only look at a seller's wholesale catalogue: the balance, how many plans, and what the node
// would quote for a few countries at its margin. Orders nothing, spends nothing.
//
//   ESIMACCESS_ACCESS_CODE_FILE=… ESIMACCESS_SECRET_KEY_FILE=… node scripts/catalog.mjs [FR ES JP …]
//
// It also checks the assumptions offers.js makes about the supplier's fields (how a multi-country
// plan names its countries, which plans have a slug, the currency) and prints what it found.
import { createClient, keysFromFiles, PRICE_UNITS } from "../src/esimaccess.js";
import { offersFromEsimAccess, quote } from "../src/offers.js";

const countries = process.argv.slice(2).filter((c) => /^[A-Za-z]{2}$/.test(c));
const client = createClient(keysFromFiles({
  accessCodeFile: process.env.ESIMACCESS_ACCESS_CODE_FILE,
  secretKeyFile: process.env.ESIMACCESS_SECRET_KEY_FILE,
}));
const pricing = { marginPct: Number(process.env.MARGIN_PCT || 20), minMarginUsd: Number(process.env.MIN_MARGIN_USD || 0.3) };

const bal = await client.balance();
console.log(`balance: $${(bal.units / PRICE_UNITS).toFixed(2)}`);
const all = await client.packages();
const multi = all.filter((p) => String(p.location || "").includes(","));
const shapes = {
  plans: all.length,
  fixed: all.filter((p) => String(p.dataType ?? "1") === "1").length,
  day_pass: all.filter((p) => String(p.dataType) === "2").length,
  with_slug: all.filter((p) => p.slug).length,
  currencies: [...new Set(all.map((p) => p.currencyCode))],
  duration_units: [...new Set(all.map((p) => p.durationUnit))],
  multi_country: multi.length,
  multi_country_example: multi[0] ? { slug: multi[0].slug, location: String(multi[0].location).slice(0, 80) } : null,
  top_up_types: [...new Set(all.map((p) => p.supportTopUpType))],
  fields: Object.keys(all[0] || {}).sort(),
};
console.log("catalogue:", JSON.stringify(shapes, null, 1));
const offers = offersFromEsimAccess(all, pricing);
console.log(`offers at ${pricing.marginPct}% (floor $${pricing.minMarginUsd}): ${offers.length}`);
for (const cc of countries.length ? countries : ["FR", "ES", "US", "JP", "TH"]) {
  const top = quote(offers, { country: cc, limit: 5 });
  console.log(`\n${cc.toUpperCase()}: ${top.length ? "" : "no plan"}`);
  for (const o of top) {
    const w = offers.find((x) => x.offer_id === o.offer_id)._wholesale_units / PRICE_UNITS;
    console.log(`  ${o.offer_id.padEnd(22)} ${String(o.data_gb).padStart(5)} GB ${String(o.days).padStart(3)} d  `
      + `$${o.price.usd.padStart(6)} (wholesale $${w.toFixed(2)})  ${o.coverage.kind}${o.coverage.kind === "country" ? "" : ` ×${o.coverage.countries.length}`}  ${o.speed}`);
  }
}
