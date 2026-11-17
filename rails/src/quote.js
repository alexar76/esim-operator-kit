// A quoted price the seller keeps for a while: what an agent can order against after it has thought.
//
// esim.quote@v1 gives every offer a quote_token and price_valid_until. The token is stateless: an
// HMAC, under a key derived from the node's secret, over the offer, the price in cents and the end of
// validity. The node checks it without storing quotes, and a buyer cannot change the price, move it
// to another offer or stretch the time.
//
// What an order that brings a token pays (priceForQuote):
// - the current price when it is not above the quoted one, whether or not the quote has expired;
// - the quoted price while the quote is valid, even if the price rose since, as long as the seller
//   does not sell below the current wholesale cost;
// - nothing, when the price rose and the quote has expired ("expired") or the quoted price is now
//   below the wholesale cost ("below_cost"): the node answers 409 with the offer as it is now and a
//   fresh token, before any payment is asked for.
import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN = /^q1\.(\d{1,12})\.(\d{1,9})\.([A-Za-z0-9_-]{43})$/;
export const QUOTE_TOKEN_PATTERN = "^q1\\.[0-9]{1,12}\\.[0-9]{1,9}\\.[A-Za-z0-9_-]{43}$";

export const centsOf = (usd) => Math.round(Number(usd) * 100);
export const usdOf = (cents) => (cents / 100).toFixed(2);
/** The wholesale cost in cents, rounded up: the seller's floor (as offers.js prices it). */
const costCents = (costUsd) => Math.ceil(Math.round(Number(costUsd) * 1e6) / 1e4);

/** The key quote tokens are signed with: derived from the node's status secret, used for nothing else. */
export function quoteKey(secret) {
  if (!secret || String(secret).length < 16) throw new Error("quote tokens need a secret of 16+ characters");
  return createHmac("sha256", String(secret)).update("esim-quote-key/v1").digest();
}

const mac = (key, offerId, cents, until) =>
  createHmac("sha256", key).update(`esim-quote/v1|${offerId}|${cents}|${until}`).digest("base64url");

/** The token and validity for `offer` (a public offer: offer_id, price.usd), valid until `untilMs`. */
export function issueQuote(key, offer, untilMs) {
  const until = Math.floor(untilMs / 1000);
  const cents = centsOf(offer.price.usd);
  return {
    quote_token: `q1.${until}.${cents}.${mac(key, offer.offer_id, cents, until)}`,
    price_valid_until: new Date(until * 1000).toISOString(),
  };
}

/** → {cents, untilMs} for a token this node issued for `offerId`, else null (malformed, forged, another offer). */
export function readQuote(key, token, offerId) {
  const m = TOKEN.exec(typeof token === "string" ? token : "");
  if (!m) return null;
  const until = Number(m[1]), cents = Number(m[2]);
  const want = Buffer.from(mac(key, String(offerId), cents, until));
  const got = Buffer.from(m[3]);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  return { cents, untilMs: until * 1000 };
}

/**
 * What an order for `offer` pays: `offer` is the catalogue's current one (with `_cost_usd`), `quote`
 * readQuote's answer or null. → {kind, cents}: "current" (no quote, or the price did not rise),
 * "honoured" (the quoted price, below today's), "expired" or "below_cost" (not sold at either price).
 */
export function priceForQuote(offer, quote, nowMs) {
  const current = centsOf(offer.price.usd);
  if (!quote || quote.cents >= current) return { kind: "current", cents: current };
  if (nowMs > quote.untilMs) return { kind: "expired", cents: current };
  const cost = Number(offer._cost_usd);
  if (!(cost > 0) || quote.cents < costCents(cost)) return { kind: "below_cost", cents: current };
  return { kind: "honoured", cents: quote.cents };
}

/** `offer` at `cents`: the price and the price per GiB that goes with it. */
export function atPrice(offer, cents) {
  const gib = Number(offer.data_bytes) / 1024 ** 3;
  return {
    ...offer,
    price: { ...offer.price, usd: usdOf(cents) },
    ...(gib > 0 ? { usd_per_gb: Math.round((cents / 100 / gib) * 100) / 100 } : {}),
  };
}
