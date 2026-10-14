// node.toml for `aimarket node` (docs/operator-guide.md, step 7), written from the live catalogue.
//
// The two free capabilities are described, with `country` as an enum of the ISO codes the catalogue
// covers: agents see what can be bought, and the admission sandbox — which fills a required string
// with "sandbox" unless the schema names its values — calls esim.quote with a real country (the
// enum's first) and gets real offers back. The order is not described: every plan has its own
// price and a node.toml capability has one; quote answers name the /order URL agents pay over x402.
const q = (s) => JSON.stringify(String(s));
const FIRST = ["US", "FR", "ES", "IT", "DE", "GB", "TR", "TH", "JP"];

export function nodeToml({ name, url, upstream = "http://127.0.0.1:9490", product, countries }) {
  if (!/^https:\/\/[^/\s]+/.test(url || "")) throw new Error("url must be the node's public https address");
  if (!/^[a-z0-9][a-z0-9._-]{1,60}$/.test(product || "")) throw new Error("product must be a short slug, e.g. esim-yourshop");
  const codes = [...new Set((countries || []).filter((c) => /^[A-Z]{2}$/.test(c)))].sort();
  if (!codes.length) throw new Error("the catalogue covers no country");
  const ordered = [...FIRST.filter((c) => codes.includes(c)), ...codes.filter((c) => !FIRST.includes(c))];
  return `# Written by scripts/node-toml.mjs from the catalogue: ${codes.length} countries. Rerun it when the catalogue changes.
name = ${q(name)}
url = ${q(url.replace(/\/+$/, ""))}
upstream = ${q(upstream)}

[[capability]]
id = "esim.quote@v1"
product = ${q(product)}
description = "Travel data eSIM plans covering a country, cheapest first: data, days, networks and the price in USDC. Each offer is bought at this seller's /order over x402 (the answer names the URL)."
price_usd = 0
method = "POST"
path = "/quote"
input_schema = { type = "object", required = ["country"], properties = { country = { type = "string", description = "ISO 3166-1 alpha-2 code of the destination", enum = [${ordered.map(q).join(", ")}] }, min_gb = { type = "number" }, min_days = { type = "integer" }, max_usd = { type = "number" }, limit = { type = "integer" } } }

[[capability]]
id = "esim.status@v1"
product = ${q(product)}
description = "State, data used and expiry of an eSIM bought from this seller, for the holder of its status token."
price_usd = 0
method = "POST"
path = "/status"
input_schema = { type = "object", required = ["esim_tran_no", "status_token"], properties = { esim_tran_no = { type = "string" }, status_token = { type = "string" } } }
`;
}
