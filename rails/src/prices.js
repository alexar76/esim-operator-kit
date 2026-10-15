// Your own prices over the formula: a price list (CSV or JSON) that the store and the seller node read
// at start (PRICES_FILE). Each rule picks plans and either fixes their price or gives them their own
// margin; a plan no rule picks is priced by MARGIN_PCT and MIN_MARGIN_USD.
//
//   match           TR_1_7           one plan, by its offer id
//                   TR               the single-country plans of a country (ISO 3166-1 alpha-2)
//                   region, global   the multi-country plans
//                   *                every plan
//   gb, days        optional, beside a country, region, global or *: only plans of that size and length
//                   (gb matches give or take 10 %: suppliers count a gigabyte as 1000 or 1024 MB)
//   price_usd       a fixed price, e.g. 4.50, or "off": the plan is not offered
//   margin_pct, min_margin_usd   or the formula with these numbers (one left empty keeps the default)
//
// The most specific rule wins: an offer id over a country, a country over region and global, those over
// *, then the rule with more of gb and days. Of two equally specific rules, the one higher in the file.
// A fixed price never sells below cost: when the supplier's cost rises above it, the formula prices that
// plan until the list changes, and scripts/catalog.mjs says so.

const COLUMNS = ["match", "gb", "days", "price_usd", "margin_pct", "min_margin_usd"];
const OFFER_ID = /^[A-Za-z0-9_.,-]{1,64}$/;
const RANK = { offer: 3, country: 2, region: 1, global: 1, any: 0 };

export class PriceListError extends Error {}

const blank = (v) => v === undefined || v === null || String(v).trim() === "";

/** A number from a cell; "4,50" is read as 4.50, the way spreadsheets in many locales write it. */
function number(v, where, name, { min = 0, max = 100_000, integer = false, positive = false } = {}) {
  const s = String(v).trim().replace(/^(\d+),(\d+)$/, "$1.$2");
  const n = /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  if (!Number.isFinite(n) || n < min || n > max || (positive && n <= 0) || (integer && !Number.isInteger(n))) {
    throw new PriceListError(`${where}: ${name} "${v}" is not ${integer ? "a whole number" : "a number"}${positive ? " above 0" : ""}`);
  }
  return n;
}

function compileRule(row, where, order) {
  const unknown = Object.keys(row).filter((k) => k !== "__line" && !COLUMNS.includes(k));
  if (unknown.length) throw new PriceListError(`${where}: unknown column ${unknown.join(", ")} (columns: ${COLUMNS.join(", ")})`);
  const raw = String(row.match ?? "").trim();
  let kind, value = null;
  if (!raw) throw new PriceListError(`${where}: match is empty`);
  if (raw === "*") kind = "any";
  else if (/^(region|global)$/i.test(raw)) kind = raw.toLowerCase();
  else if (/^[A-Za-z]{2}$/.test(raw)) { kind = "country"; value = raw.toUpperCase(); }
  else if (OFFER_ID.test(raw)) { kind = "offer"; value = raw; }
  else throw new PriceListError(`${where}: match "${raw}" is not an offer id, a country code, region, global or *`);

  const gb = blank(row.gb) ? null : number(row.gb, where, "gb", { positive: true });
  const days = blank(row.days) ? null : number(row.days, where, "days", { integer: true, positive: true, max: 3650 });
  if (kind === "offer" && (gb !== null || days !== null)) {
    throw new PriceListError(`${where}: ${raw} is one plan already, leave gb and days empty`);
  }
  const price = blank(row.price_usd) ? null : String(row.price_usd).trim();
  const off = price !== null && price.toLowerCase() === "off";
  let fixedCents = null;
  if (price !== null && !off) {
    if (!/^\d+([.,]\d{1,2})?$/.test(price)) throw new PriceListError(`${where}: price_usd "${price}" is not a price in dollars and cents, nor "off"`);
    fixedCents = Math.round(number(price, where, "price_usd", { positive: true }) * 100);
  }
  const marginPct = blank(row.margin_pct) ? null : number(row.margin_pct, where, "margin_pct", { max: 10_000 });
  const minMarginUsd = blank(row.min_margin_usd) ? null : number(row.min_margin_usd, where, "min_margin_usd", { max: 10_000 });
  if (price !== null && (marginPct !== null || minMarginUsd !== null)) {
    throw new PriceListError(`${where}: give price_usd or a margin, not both`);
  }
  if (price === null && marginPct === null && minMarginUsd === null) {
    throw new PriceListError(`${where}: says nothing about the price: fill price_usd, margin_pct or min_margin_usd`);
  }
  const label = [kind === "any" ? "*" : kind === "region" || kind === "global" ? kind : value, gb !== null ? `${gb} GB` : "", days !== null ? `${days} days` : ""].filter(Boolean).join(" ");
  return { kind, value, gb, days, off, fixedCents, marginPct, minMarginUsd, label, where, order,
           rank: RANK[kind] * 10 + (gb !== null) + (days !== null) };
}

/** Rows ({match, gb, days, price_usd, margin_pct, min_margin_usd}) → rules, most specific first. */
export function compileRules(rows, source = "price list") {
  if (!Array.isArray(rows)) throw new PriceListError(`${source}: expected a list of rules`);
  const seen = new Map();
  const rules = rows.map((row, i) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new PriceListError(`${source}, rule ${i + 1}: not an object`);
    const where = `${source}, ${row.__line ? `line ${row.__line}` : `rule ${i + 1}`}`;
    const rule = compileRule(row, where, i);
    const key = [rule.kind, rule.value, rule.gb, rule.days].join("|");
    if (seen.has(key)) throw new PriceListError(`${where}: picks the same plans as ${seen.get(key)} (${rule.label})`);
    seen.set(key, where.slice(source.length + 2));
    return rule;
  });
  return rules.sort((a, b) => b.rank - a.rank || a.order - b.order);
}

/** One CSV line → cells. Quotes as spreadsheets write them ("a,b", "say ""hi"""). */
function cells(line, sep) {
  const out = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur.trim() === "") { quoted = true; cur = ""; }
    else if (ch === sep) { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** CSV text → rows. A header line first; lines starting with # and empty lines are skipped. A
 *  spreadsheet's semicolon-separated export works too. */
export function parseCsv(text, source = "price list") {
  const lines = String(text).replace(/^﻿/, "").split(/\r?\n/);
  let header = null, sep = ",";
  const rows = [];
  lines.forEach((line, i) => {
    if (!line.trim() || line.trim().startsWith("#")) return;
    if (!header) {
      sep = line.includes(";") && !line.includes(",") ? ";" : ",";
      header = cells(line, sep).map((h) => h.toLowerCase());
      if (!header.includes("match")) throw new PriceListError(`${source}, line ${i + 1}: the first line must name the columns, starting with match`);
      return;
    }
    const values = cells(line, sep);
    if (values.length > header.length) throw new PriceListError(`${source}, line ${i + 1}: ${values.length} cells under ${header.length} columns`);
    const row = { __line: i + 1 };
    header.forEach((h, j) => { if (!blank(values[j])) row[h] = values[j]; });
    rows.push(row);
  });
  return rows;
}

/** A price list's text → rules. JSON when it starts with [ or {, CSV otherwise. */
export function parsePriceList(text, source = "price list") {
  const t = String(text).replace(/^﻿/, "").trim();
  if (t.startsWith("[") || t.startsWith("{")) {
    let doc;
    try { doc = JSON.parse(t); } catch (err) { throw new PriceListError(`${source}: not valid JSON (${err.message})`); }
    return compileRules(Array.isArray(doc) ? doc : doc?.rules, source);
  }
  return compileRules(parseCsv(t, source), source);
}

const sameSize = (gb, want) => Math.abs(gb - want) <= want * 0.1;

/** The rule that prices a plan, or null. `plan`: {id, kind, countries, data_gb, days}. */
export function ruleFor(rules, plan) {
  for (const r of rules || []) {
    if (r.kind === "offer" ? plan.id !== r.value
      : r.kind === "country" ? !(plan.kind === "country" && plan.countries.length === 1 && plan.countries[0] === r.value)
      : r.kind !== "any" && plan.kind !== r.kind) continue;
    if (r.gb !== null && !sameSize(plan.data_gb, r.gb)) continue;
    if (r.days !== null && plan.days !== r.days) continue;
    return r;
  }
  return null;
}
