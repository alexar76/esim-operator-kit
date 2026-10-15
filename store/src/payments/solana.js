// USDC on Solana through Solana Pay (Phantom, Solflare, Backpack and every wallet that reads a
// solana: link or its QR code). Each order gets a fresh `reference` key the wallet adds to the
// transfer; the store finds the transaction by that key and checks that the store's USDC balance
// rose by at least the price in it.
import { randomBytes } from "node:crypto";
import { encode, isSolanaAddress } from "./base58.js";

export const USDC_SOLANA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";   // 6 decimals (getTokenSupply)

export function solanaUsdc({ address = "", rpc = "https://api.mainnet-beta.solana.com", fetchImpl = globalThis.fetch,
                             storeName = "eSIM" }) {
  if (address && !isSolanaAddress(address)) throw new Error("PAY_TO_SOLANA is not a Solana address");
  const call = async (method, params) => {
    const res = await fetchImpl(rpc, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15_000) });
    const d = await res.json();
    if (d.error) throw new Error(`solana rpc ${d.error.code}`);
    return d.result;
  };

  return {
    id: "solana",
    kind: "push",
    enabled: () => Boolean(address),
    options: () => [{ id: "sol-usdc", network: "Solana", token: "USDC" }],

    intent(order) {
      const reference = encode(randomBytes(32));
      const amount = (order.price_cents / 100).toFixed(2);
      const q = new URLSearchParams({ amount, "spl-token": USDC_SOLANA, reference, label: storeName, message: order.memo });
      return {
        method: "solana", asset: "USDC", network: "Solana", to: address, reference, units: String(order.price_cents * 10_000),
        amount_display: `${amount} USDC`, uri: `solana:${address}?${q.toString()}`,
      };
    },

    async find(intent, { since }) {
      const sigs = await call("getSignaturesForAddress", [intent.reference, { limit: 10, commitment: "confirmed" }]);
      for (const s of sigs || []) {
        if (s.err || (s.blockTime && s.blockTime * 1000 < since)) continue;
        const tx = await call("getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
        if (!tx || tx.meta?.err) continue;
        const bal = (list, i) => BigInt((list || []).find((b) => b.accountIndex === i)?.uiTokenAmount?.amount ?? "0");
        const received = (tx.meta.postTokenBalances || [])
          .filter((b) => b.mint === USDC_SOLANA && b.owner === address)
          .reduce((sum, b) => sum + bal(tx.meta.postTokenBalances, b.accountIndex) - bal(tx.meta.preTokenBalances, b.accountIndex), 0n);
        if (received >= BigInt(intent.units)) {
          const payer = tx.transaction?.message?.accountKeys?.find((k) => k.signer)?.pubkey ?? null;
          return { status: "paid", ref: `sol:${s.signature}`, payer, units: received.toString() };
        }
        if (received > 0n) return { status: "underpaid", ref: `sol:${s.signature}`, units: received.toString() };
      }
      return { status: "pending" };
    },
  };
}
