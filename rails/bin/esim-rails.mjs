#!/usr/bin/env node
// esim-rails: the kit's command line.
//   esim-rails check <seller node URL> [--country FR]   does a node answer the esim.*@v1 contract?
//   esim-rails schemas                                  where the contract's JSON Schemas are
//   esim-rails prices <price list>                      does a price list read, and what does each line say?
import { readFileSync } from "node:fs";
import { checkSeller, report } from "../src/check.js";
import { parsePriceList, PriceListError } from "../src/prices.js";
import { schemaNames } from "../src/schema.js";

const [cmd, url, ...rest] = process.argv.slice(2);
const opt = (k, d) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : d; };
if (cmd === "check" && url) {
  const failed = report(await checkSeller(url, { country: String(opt("country", "FR")).toUpperCase() }));
  process.exit(failed ? 1 : 0);
} else if (cmd === "schemas") {
  const dir = new URL("../spec/esim-v1/", import.meta.url).pathname;
  for (const n of schemaNames()) console.log(`${dir}${n}`);
} else if (cmd === "prices" && url) {
  // Offline: the plans and their costs are in the node, `scripts/catalog.mjs` shows what each rule priced.
  try {
    const rules = parsePriceList(readFileSync(url, "utf8"), url);
    for (const r of [...rules].sort((a, b) => a.order - b.order)) {
      const what = r.off ? "not offered" : r.fixedCents !== null ? `$${(r.fixedCents / 100).toFixed(2)}`
        : [r.marginPct !== null ? `margin ${r.marginPct} %` : "", r.minMarginUsd !== null ? `at least $${r.minMarginUsd.toFixed(2)}` : ""].filter(Boolean).join(", ");
      console.log(`${r.where.split(", ").pop().padEnd(9)} ${r.label.padEnd(24)} ${what}`);
    }
    console.log(`${rules.length} rules read; the most specific one prices each plan`);
  } catch (err) {
    console.error(err instanceof PriceListError ? err.message : `${url}: ${err.message}`);
    process.exit(1);
  }
} else {
  console.log("usage: esim-rails check <seller node URL, e.g. https://esim.example.com/agents> [--country FR]\n       esim-rails schemas\n       esim-rails prices <price list, CSV or JSON>");
  process.exit(cmd ? 1 : 0);
}
