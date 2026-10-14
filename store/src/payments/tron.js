// USDT on Tron (TRC-20): the commonest way people pay in crypto, and one with no memo field a wallet
// or an exchange fills in. So every order asks for its own exact amount — the price plus a few
// millionths of a dollar — and the store finds the payment by that amount among the confirmed
// USDT transfers to its address (TronGrid). TronLink pays it from the page; any other wallet or an
// exchange withdrawal pays it by hand. Only the exact amount counts: it is the order's identity.
import { randomInt } from "node:crypto";
import { isTronAddress } from "./base58.js";

export const USDT_TRON = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";   // Tether USD, 6 decimals (TronGrid token_info)

export function tronUsdt({ address = "", api = "https://api.trongrid.io", apiKey = "", fetchImpl = globalThis.fetch,
                           uniq = () => randomInt(1, 10_000) }) {
  if (address && !isTronAddress(address)) throw new Error("PAY_TO_TRON is not a Tron address");
  const headers = apiKey ? { "TRON-PRO-API-KEY": apiKey } : {};

  return {
    id: "tron",
    kind: "push",
    enabled: () => Boolean(address),
    options: () => [{ id: "tron-usdt", network: "Tron", token: "USDT" }],

    intent(order) {
      // Up to $0.0099 above the price: enough to tell 9 999 open orders apart, never a cent more.
      const units = String(order.price_cents * 10_000 + uniq());
      const shown = (Number(units) / 1e6).toFixed(6);
      return {
        method: "tron", asset: "USDT", network: "Tron", to: address, token_address: USDT_TRON, decimals: 6,
        units, amount_display: `${shown} USDT`, exact: shown,
        uri: address,   // wallets read a plain address; the amount is typed or set by TronLink
      };
    },

    /** The confirmed USDT transfer to the store of exactly this amount, since the order was made. */
    async find(intent, { since }) {
      const url = `${api}/v1/accounts/${address}/transactions/trc20?only_to=true&only_confirmed=true&limit=200`
        + `&contract_address=${USDT_TRON}&min_timestamp=${Math.max(0, since)}`;
      const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`trongrid ${res.status}`);
      const d = await res.json();
      const hit = (d.data || []).find((t) => t.to === address && t.token_info?.address === USDT_TRON
        && t.type === "Transfer" && String(t.value) === intent.units);
      return hit ? { status: "paid", ref: `tron:${hit.transaction_id}`, payer: hit.from, units: String(hit.value) } : { status: "pending" };
    },
  };
}
