// USDC on Base, paid by signature: the buyer signs an EIP-3009 TransferWithAuthorization in any EVM
// wallet (no ETH needed for gas), the storefront verifies it with the facilitator, delivers the
// eSIM, and only then settles. A settlement that fails cancels the profile it bought.
//
// The requirements are the x402 `exact` terms our seller node's 402 carries (esim-rails), so the same
// facilitator (Coinbase CDP) verifies and settles both.
import { randomBytes } from "node:crypto";

export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const BASE = { network: "eip155:8453", chainId: 8453, name: "Base" };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX32 = /^0x[0-9a-fA-F]{64}$/;

export function usdcBase({ payTo, facilitator, now = () => Date.now() }) {
  if (payTo && !ADDRESS.test(payTo)) throw new Error("payTo must be an EVM address");
  const requirements = (order) => ({
    scheme: "exact",
    network: BASE.network,
    amount: String(order.price_cents * 10_000),        // cents → USDC's 6 decimals
    asset: USDC_BASE,
    payTo,
    maxTimeoutSeconds: 300,
    extra: { name: "USD Coin", version: "2" },
  });

  return {
    id: "usdc-base",
    kind: "authorize",
    label: "USDC · Base",
    enabled: () => Boolean(payTo && facilitator),

    /** What the browser signs: the EIP-712 typed data of one authorization for this order. */
    intent(order) {
      const req = requirements(order);
      const t = Math.floor(now() / 1000);
      return {
        method: "usdc-base",
        chain_id: BASE.chainId,
        chain_name: BASE.name,
        token: { symbol: "USDC", address: USDC_BASE, decimals: 6 },
        amount: req.amount,
        amount_display: `${(order.price_cents / 100).toFixed(2)} USDC`,
        typed_data: {
          domain: { name: req.extra.name, version: req.extra.version, chainId: BASE.chainId, verifyingContract: USDC_BASE },
          primaryType: "TransferWithAuthorization",
          types: {
            EIP712Domain: [
              { name: "name", type: "string" }, { name: "version", type: "string" },
              { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
            ],
            TransferWithAuthorization: [
              { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
              { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
            ],
          },
          // `from` is the buyer's address, filled in by the browser once a wallet is connected.
          message: { to: payTo, value: req.amount, validAfter: "0", validBefore: String(t + req.maxTimeoutSeconds),
                     nonce: "0x" + randomBytes(32).toString("hex") },
        },
      };
    },

    /**
     * The buyer's signed authorization → an x402 payment the facilitator checks. Returns
     * {ok, ref, payer, payment} or {ok: false, reason}; `ref` (payer + nonce) is what makes one
     * payment one eSIM order downstream.
     */
    async verify(order, submission) {
      const a = submission?.authorization || {};
      const sig = String(submission?.signature || "");
      const req = requirements(order);
      if (!ADDRESS.test(a.from || "") || !HEX32.test(a.nonce || "") || !/^0x[0-9a-fA-F]{130}$/.test(sig)) {
        return { ok: false, reason: "malformed_authorization" };
      }
      if (String(a.to).toLowerCase() !== payTo.toLowerCase() || String(a.value) !== req.amount) {
        return { ok: false, reason: "wrong_terms" };
      }
      const payment = {
        x402Version: 2,
        accepted: req,
        payload: {
          signature: sig,
          authorization: { from: a.from, to: a.to, value: String(a.value), validAfter: String(a.validAfter ?? "0"),
                           validBefore: String(a.validBefore), nonce: a.nonce },
        },
      };
      let res;
      try { res = await facilitator.verify(payment, req); } catch { return { ok: false, reason: "facilitator_unreachable" }; }
      if (!res?.isValid) return { ok: false, reason: res?.invalidReason || "invalid_payment" };
      return { ok: true, ref: `usdc-base:${a.from.toLowerCase()}:${a.nonce.toLowerCase()}`, payer: a.from, payment };
    },

    /** Move the money: only after the eSIM was delivered. */
    async settle(order, verified) {
      try {
        const res = await facilitator.settle(verified.payment, requirements(order));
        return res?.success ? { ok: true, tx: res.transaction || null } : { ok: false, reason: res?.errorReason || "settle_failed" };
      } catch {
        return { ok: false, reason: "facilitator_unreachable" };
      }
    },
  };
}

/** The CDP facilitator behind the two calls above, built from the same key file as the seller node. */
export async function cdpFacilitator({ cdpKeyFile, payTo, readFile }) {
  const key = JSON.parse(await readFile(cdpKeyFile, "utf8"));
  const { createX402Server } = await import("@coinbase/cdp-sdk/x402");
  const server = await createX402Server({
    apiKeyId: key.id, apiKeySecret: key.privateKey, environment: "production",
    payToConfig: { type: "address", evm: payTo },
    routes: { "POST /checkout": { accepts: { scheme: "exact", price: "$1.00", network: BASE.network, payTo } } },
  });
  await server.initialize?.();
  const rs = server.resourceServer;
  return {
    verify: (payment, req) => rs.verifyPayment(payment, req),
    settle: (payment, req) => rs.settlePayment(payment, req),
  };
}
