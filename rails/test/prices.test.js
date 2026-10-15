// An operator's own price list over the formula (src/prices.js): how a list reads, which rule prices a
// plan, and the mistakes it refuses at start rather than selling at prices nobody meant.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pricingFromEnv } from "../src/config.js";
import { DEFAULT_PRICING, offersFromPlans, publicOffer, quote } from "../src/offers.js";
import { parsePriceList, PriceListError } from "../src/prices.js";

const GIB = 1024 ** 3;
const plan = (id, countries, gb, days, cost, extra = {}) =>
  ({ id, name: id, countries, data_bytes: Math.round(gb * GIB), days, cost_usd: cost, ...extra });
const PLANS = [
  plan("TR_1_7", ["TR"], 1, 7, 0.9),
  plan("TR_3_30", ["TR"], 3, 30, 2.1),
  plan("TR_0.1_7", ["TR"], 0.1, 7, 0.3),
  plan("JP_1_7", ["JP"], 1, 7, 0.8),
  plan("EU-30_1_7", ["TR", "FR", "DE"], 1, 7, 1.1, { kind: "region" }),
  plan("GL-120_1_7", ["TR", "JP", "US"], 1, 7, 3, { kind: "global" }),
  { ...plan("JP_1000MB_7", ["JP"], 1, 7, 0.8), data_bytes: 1000 * 1024 * 1024 },   // a supplier's "1 GB" of 1000 MB
];
const priced = (csv, base = DEFAULT_PRICING) =>
  Object.fromEntries(offersFromPlans(PLANS, { ...base, rules: parsePriceList(csv) }).map((o) => [o.offer_id, o]));

test("a price list: the most specific rule prices each plan, the formula the rest", () => {
  const o = priced([
    "# an operator's list",
    "match,gb,days,price_usd,margin_pct,min_margin_usd",
    "*,,,,150,",
    "TR,,,,50,0.50",
    "TR,1,7,4.50,,",
    "region,,,,,2",
    "GL-120_1_7,,,9.99,,",
  ].join("\n"));
  assert.equal(o["TR_1_7"].price.usd, "4.50");                 // country + gb + days over country
  assert.equal(o["TR_1_7"]._price_rule, "TR 1 GB 7 days");
  assert.equal(o["TR_3_30"].price.usd, "3.15");                // TR: $2.10 + 50 % = $3.15 beats the $0.50 floor
  assert.equal(o["TR_0.1_7"].price.usd, "0.80");               // TR: $0.30 + the $0.50 floor
  assert.equal(o["JP_1_7"].price.usd, "2.00");                 // *: $0.80 + 150 % = $2.00 > $0.80 + $1 (the default floor)
  assert.equal(o["EU-30_1_7"].price.usd, "3.10");              // region: $1.10 × 2 (the default 100 %) < $1.10 + $2
  assert.equal(o["GL-120_1_7"].price.usd, "9.99");             // an offer id over everything
  // a country rule is about that country's own plans: the regional plan that covers TR is not one
  assert.equal(o["EU-30_1_7"]._price_rule, "region");
  // what a buyer sees carries neither the rule nor the cost
  const seen = JSON.stringify(quote(Object.values(o), { country: "TR" }));
  assert.ok(!seen.includes("_price_rule") && !seen.includes("_cost_usd"));
  assert.deepEqual(Object.keys(publicOffer(o["TR_1_7"])).filter((k) => k.startsWith("_")), []);
});

test("off takes a plan out; a fixed price under the cost falls back to the formula, flagged", () => {
  const o = priced("match,gb,days,price_usd\nTR,0.1,,off\nJP_1_7,,,0.50\nTR_3_30,,,2.10");
  assert.equal(o["TR_0.1_7"], undefined);
  assert.equal(o["JP_1_7"].price.usd, "1.80");                 // $0.50 < $0.80 cost: the formula, $0.80 + $1
  assert.equal(o["JP_1_7"]._below_cost, true);
  assert.equal(o["TR_3_30"].price.usd, "2.10");                // exactly the cost is the operator's call
  assert.equal(o["TR_3_30"]._below_cost, undefined);
});

test("gb matches the size give or take 10 %, so 1000 MB and 1024 MB are both 1 GB; days match exactly", () => {
  const o = priced("match,gb,days,price_usd\nJP,1,7,5\nJP,1,30,9");
  assert.equal(o["JP_1_7"].price.usd, "5.00");
  assert.equal(o["JP_1000MB_7"].price.usd, "5.00");
  assert.equal(priced("match,gb,price_usd\nTR,0.5,1")["TR_0.1_7"].price.usd, "1.30");   // 0.1 GB is not 0.5 GB
});

test("equally specific rules: the one higher in the file wins", () => {
  const o = priced("match,gb,days,price_usd\nTR,1,,6\nTR,,7,5");
  assert.equal(o["TR_1_7"].price.usd, "6.00");
  assert.equal(o["TR_0.1_7"].price.usd, "5.00");
});

test("a spreadsheet's export reads: semicolons, decimal commas, quotes, a byte order mark, CRLF", () => {
  const rules = parsePriceList('﻿match;gb;price_usd\r\n"TR";1;4,50\r\n"EU-30_1_7";;"3,10"\r\n');
  assert.deepEqual(rules.map((r) => [r.label, r.fixedCents]), [["EU-30_1_7", 310], ["TR 1 GB", 450]]);
  const json = parsePriceList(JSON.stringify({ rules: [{ match: "tr", gb: 1, price_usd: 4.5 }, { match: "*", margin_pct: 80 }] }));
  assert.deepEqual(json.map((r) => r.label), ["TR 1 GB", "*"]);
});

test("a list with a mistake does not read, and says where", () => {
  const bad = (text, re) => assert.throws(() => parsePriceList(text, "prices.csv"), (e) => e instanceof PriceListError && re.test(e.message), re);
  bad("match,price\nTR,4", /line 2: unknown column price/);
  bad("gb,price_usd\n1,4", /line 1: the first line must name the columns/);
  bad("match,price_usd\n,4", /line 2: match is empty/);
  bad("match,price_usd,margin_pct\nTR,4,50", /line 2: give price_usd or a margin, not both/);
  bad("match,gb\nTR,1", /line 2: says nothing about the price/);
  bad("match,gb,price_usd\nTR_1_7,1,4", /line 2: TR_1_7 is one plan already/);
  bad("match,price_usd\nTR,4.555", /line 2: price_usd "4.555" is not a price/);
  bad("match,price_usd\nTR,-1", /line 2: price_usd "-1" is not a price/);
  bad("match,days,price_usd\nTR,7.5,4", /line 2: days "7.5" is not a whole number/);
  bad("match,margin_pct\nTR,lots", /line 2: margin_pct "lots" is not a number/);
  bad("match,gb,price_usd\nTR,1,4\ntr,1,5", /line 3: picks the same plans as line 2 \(TR 1 GB\)/);
  bad("match,price_usd\nTR,4,5", /line 2: 3 cells under 2 columns/);
  bad("match,price_usd\nT R,4", /match "T R" is not an offer id/);
  bad('[{"match": "TR", "price_usd": 4}, {"match": "JP"}]', /rule 2: says nothing about the price/);
  bad("{not json", /not valid JSON/);
});

test("the prices from the environment: the default, MARGIN_PCT 0, a bad number and a missing list stop the start", () => {
  assert.deepEqual(pricingFromEnv({}), { marginPct: 100, minMarginUsd: 1 });
  assert.deepEqual(pricingFromEnv({ MARGIN_PCT: "0", MIN_MARGIN_USD: "0.01" }), { marginPct: 0, minMarginUsd: 0.01 });
  assert.throws(() => pricingFromEnv({ MARGIN_PCT: "20%" }), /MARGIN_PCT must be a number/);
  assert.throws(() => pricingFromEnv({ PRICES_FILE: "/nowhere/prices.csv" }), /PRICES_FILE=\/nowhere\/prices.csv does not exist/);
  const dir = mkdtempSync(join(tmpdir(), "esim-prices-"));
  const file = join(dir, "prices.csv");
  writeFileSync(file, "match,price_usd\nTR_1_7,4.50\n");
  const p = pricingFromEnv({ PRICES_FILE: file, MARGIN_PCT: "60" });
  assert.equal(p.marginPct, 60);
  assert.equal(p.file, file);
  assert.equal(offersFromPlans(PLANS, p).find((o) => o.offer_id === "TR_1_7").price.usd, "4.50");
  writeFileSync(file, "match,price_usd\nTR_1_7,4.5.0\n");
  assert.throws(() => pricingFromEnv({ PRICES_FILE: file }), /prices\.csv, line 2/);
});

test("the shipped example reads, and `esim-rails prices` checks a list without keys", () => {
  const example = new URL("../../config/prices.example.csv", import.meta.url).pathname;
  const bin = new URL("../bin/esim-rails.mjs", import.meta.url).pathname;
  const out = execFileSync(process.execPath, [bin, "prices", example], { encoding: "utf8" });
  assert.match(out, /TR 1 GB 7 days\s+\$4\.50/);
  assert.match(out, /US_0\.1_7\s+not offered/);
  assert.match(out, /rules read/);
  const dir = mkdtempSync(join(tmpdir(), "esim-prices-"));
  writeFileSync(join(dir, "bad.csv"), "match,price_usd\nTR,4\nTR,5\n");
  assert.throws(() => execFileSync(process.execPath, [bin, "prices", join(dir, "bad.csv")], { stdio: "pipe" }),
                (e) => e.status === 1 && /line 3: picks the same plans as line 2/.test(String(e.stderr)));
});
