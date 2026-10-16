// The conformance check: does a seller node answer the esim.*@v1 contract the way agents and hubs
// expect? Run it against your own node — the kit's, or one you wrote in another language:
//
//   npx @aimarket/esim-rails check https://esim.example.com/agents [--country FR]
//
// It calls only free routes and asks the paid one for its price; it never pays.
import { createPublicKey, verify } from "node:crypto";
import { boundCanonical } from "./node.js";
import { validate } from "./schema.js";

const pubkeyFromB64 = (b64) => createPublicKey({
  key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(b64, "base64")]), format: "der", type: "spki" });

export async function checkSeller(base, { country = "FR", fetchImpl = globalThis.fetch } = {}) {
  const root = String(base).replace(/\/+$/, "");
  const results = [];
  const ok = (name, detail = "") => results.push({ name, ok: true, detail });
  const fail = (name, detail) => results.push({ name, ok: false, detail });
  const warn = (name, detail) => results.push({ name, ok: true, warn: true, detail });
  const call = async (path, body, init = {}) => {
    const url = path.startsWith("http") ? path : `${root}${path}`;
    const res = await fetchImpl(url, body === undefined ? init
      : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), ...init });
    let json = null;
    try { json = await res.clone().json(); } catch { json = null; }
    return { res, json };
  };

  // 1. The listing: which capabilities, which key, where the order is bought.
  let listing;
  try {
    const { res, json } = await call("/listing.json");
    listing = json;
    const caps = (json?.listings || []).map((l) => l.capability_id);
    if (res.ok && caps.includes("esim.quote@v1") && (caps.includes("esim.status@v1") || json.status?.url && json.status.direct_only === true) && json.order?.url) ok("listing.json", `${caps.join(", ")}; order at ${json.order.url}`);
    else fail("listing.json", `HTTP ${res.status}; needs esim.quote@v1, a direct status URL (or legacy status capability), and order.url`);
  } catch (err) { fail("listing.json", err.message); return results; }
  const quoteListing = listing?.listings?.find((l) => l.capability_id === "esim.quote@v1");
  const productId = quoteListing?.product_id;
  const pubkey = quoteListing?.provider_pubkey;

  // 2. A quote: schema, order of offers, signature.
  const input = { country, min_gb: 1, limit: 5 };
  let offers = [];
  try {
    const { res, json } = await call("/quote", input);
    const problems = json?.success === true ? validate("quote-result", json.result) : ["$.success: not true"];
    offers = json?.result?.offers || [];
    if (!res.ok || problems.length) fail("esim.quote@v1 answer", problems.slice(0, 5).join("; ") || `HTTP ${res.status}`);
    else if (!offers.length) warn("esim.quote@v1 answer", `no offer for ${country}: try --country with a country you sell`);
    else ok("esim.quote@v1 answer", `${offers.length} offers for ${country}, all valid`);
    const prices = offers.map((o) => Number(o.price.usd));
    if (prices.some((p, i) => i && p < prices[i - 1])) fail("cheapest first", prices.join(" "));
    else if (offers.length) ok("cheapest first");
    const sig = res.headers.get("x-provider-signature");
    if (!sig || !pubkey) fail("signature", "no X-Provider-Signature header or no provider_pubkey in listing.json");
    else {
      const good = verify(null, Buffer.from(boundCanonical("esim.quote@v1", productId, input, json.result)), pubkeyFromB64(pubkey), Buffer.from(sig, "base64"));
      if (good) ok("signature", "Ed25519 over the request-bound canonical, key from listing.json");
      else fail("signature", "X-Provider-Signature does not verify (canonical JSON: sorted keys, no spaces, non-ASCII as is)");
    }
  } catch (err) { fail("esim.quote@v1 answer", err.message); }

  // 3. Refusals that must not leak or crash.
  try {
    const { res, json } = await call("/quote", { country: "Narnia" });
    if (res.status === 400 && json?.success === false) ok("bad input is a 400"); else fail("bad input is a 400", `HTTP ${res.status}`);
  } catch (err) { fail("bad input is a 400", err.message); }
  try {
    const { res, json } = await call("/status", { esim_tran_no: "000000000000", status_token: "x".repeat(43) });
    if (res.status === 404 && json?.error === "not_found") ok("unknown eSIM is a 404 not_found"); else fail("unknown eSIM is a 404 not_found", `HTTP ${res.status}`);
  } catch (err) { fail("unknown eSIM is a 404 not_found", err.message); }

  // 4. The order: unknown offers refused before a price; a known one asks for its price over x402.
  const orderUrl = listing?.order?.url;
  if (orderUrl) {
    try {
      const { res, json } = await call(orderUrl, { offer_id: "no-such-offer-000" });
      if (res.status === 400 && json?.error === "unknown_offer") ok("unknown offer is a 400 before any price");
      else fail("unknown offer is a 400 before any price", `HTTP ${res.status}`);
    } catch (err) { fail("unknown offer is a 400 before any price", err.message); }
    if (offers[0]) {
      try {
        const { res, json } = await call(orderUrl, { offer_id: offers[0].offer_id });
        if (res.status === 403 && json?.error === "demo_mode") warn("x402 terms", "a demo node: it sells nothing (demo_mode)");
        else if (res.status !== 402) fail("x402 terms", `expected 402, got HTTP ${res.status}`);
        else {
          const raw = res.headers.get("payment-required");
          const terms = raw ? JSON.parse(Buffer.from(raw, "base64").toString("utf8")) : null;
          const a = terms?.accepts?.[0];
          const want = String(Math.round(Number(offers[0].price.usd) * 1e6));
          if (!a) fail("x402 terms", "402 without a PAYMENT-REQUIRED header (x402 v2)");
          else if (a.scheme !== "exact" || a.network !== "eip155:8453") fail("x402 terms", `${a.scheme} on ${a.network}; agents expect exact on eip155:8453`);
          else if (String(a.amount) !== want) fail("x402 terms", `asks ${a.amount}, the quote says ${want} (USDC, 6 decimals)`);
          else ok("x402 terms", `exact, USDC on Base, ${offers[0].price.usd} to ${a.payTo}`);
        }
      } catch (err) { fail("x402 terms", err.message); }
    }
  } else fail("order URL", "listing.json names no order.url");

  // 5. Pages may call the free routes (the kit's landing does; agents in a browser too).
  try {
    const res = await fetchImpl(`${root}/quote`, { method: "OPTIONS", headers: { origin: "https://example.org", "access-control-request-method": "POST" } });
    if (res.headers.get("access-control-allow-origin")) ok("CORS on the free routes");
    else warn("CORS on the free routes", "absent: fine for agents, but no web page can call your quotes");
  } catch { warn("CORS on the free routes", "OPTIONS failed"); }
  return results;
}

export function report(results, write = (s) => process.stdout.write(s)) {
  for (const r of results) write(`${r.ok ? (r.warn ? "⚠" : "✓") : "✗"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}\n`);
  const failed = results.filter((r) => !r.ok).length;
  write(failed ? `\n${failed} check(s) failed.\n` : "\nConforms to esim.*@v1.\n");
  return failed;
}
