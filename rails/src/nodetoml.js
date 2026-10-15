// node.toml for `aimarket node` (docs/operator-guide.md, step 7), written from the live catalogue.
//
// The two free capabilities are described, with `country` as an enum of the ISO codes the catalogue
// covers: agents see what can be bought, and the admission sandbox — which fills a required string
// with "sandbox" unless the schema names its values — calls esim.quote with a real country (the
// enum's first) and gets real offers back. The order is not described: every plan has its own
// price and a node.toml capability has one; quote answers name the /order URL agents pay over x402.
const q = (s) => JSON.stringify(String(s));
const FIRST = ["US", "FR", "ES", "IT", "DE", "GB", "TR", "TH", "JP"];

// `demo`: a node that quotes and sells nothing (DEMO_MODE=1) says so in every description, so agents
// searching a hub see a showcase, not a shop.
const DEMO_NOTE = "DEMO SELLER: live prices, orders are refused with demo_mode — a showcase of the eSIM operator kit (https://esim.modelmarket.dev). ";

// `providerPubkey`: the node's provider key (/healthz, listing.json); hubs tie buyers' signed delivery
// receipts to this listing by it.
export function nodeToml({ name, url, upstream = "http://127.0.0.1:9490", product, countries, demo = false, providerPubkey = "" }) {
  if (!/^https:\/\/[^/\s]+/.test(url || "")) throw new Error("url must be the node's public https address");
  if (!/^[a-z0-9][a-z0-9._-]{1,60}$/.test(product || "")) throw new Error("product must be a short slug, e.g. esim-yourshop");
  const codes = [...new Set((countries || []).filter((c) => /^[A-Z]{2}$/.test(c)))].sort();
  if (!codes.length) throw new Error("the catalogue covers no country");
  const ordered = [...FIRST.filter((c) => codes.includes(c)), ...codes.filter((c) => !FIRST.includes(c))];
  if (providerPubkey && !/^[A-Za-z0-9+/]{43}=$/.test(providerPubkey)) throw new Error("providerPubkey must be the node's base64 Ed25519 key");
  const key = providerPubkey ? `\nprovider_pubkey = ${q(providerPubkey)}` : "";
  return `# Written by scripts/node-toml.mjs from the catalogue: ${codes.length} countries. Rerun it when the catalogue changes.
name = ${q(name)}
description = ${q(demo
    ? `Demo seller of the eSIM operator kit: live travel eSIM offers for ${codes.length} countries; orders are refused with demo_mode. To sell, run the kit: https://esim.modelmarket.dev`
    : `Travel data eSIMs for ${codes.length} countries, quoted free and bought over x402 straight from this seller.`)}
url = ${q(url.replace(/\/+$/, ""))}
upstream = ${q(upstream)}

[[capability]]
id = "esim.quote@v1"
product = ${q(product)}
name = "Travel eSIM offers"
description = "${demo ? DEMO_NOTE : ""}Travel data eSIM plans covering a country, cheapest first: data, days, networks and the price in USDC. Each offer is bought at this seller's /order over x402 (the answer names the URL)."
price_usd = 0
method = "POST"
path = "/quote"${key}
input_schema = { type = "object", required = ["country"], properties = { country = { type = "string", description = "ISO 3166-1 alpha-2 code of the destination", enum = [${ordered.map(q).join(", ")}] }, min_gb = { type = "number" }, min_days = { type = "integer" }, max_usd = { type = "number" }, limit = { type = "integer" } } }

[[capability]]
id = "esim.status@v1"
product = ${q(product)}
name = "eSIM status and usage"
description = "${demo ? DEMO_NOTE : ""}State, data used and expiry of an eSIM bought from this seller, for the holder of its status token."
price_usd = 0
method = "POST"
path = "/status"${key}
input_schema = { type = "object", required = ["esim_tran_no", "status_token"], properties = { esim_tran_no = { type = "string" }, status_token = { type = "string" } } }
`;
}
