// Refunds to agents without gas. The node signs a USDC transfer from its refund wallet to the payer, an
// EIP-3009 authorization exactly like an x402 payment, and the CDP facilitator puts it on chain and pays
// the gas. So the refund wallet needs USDC only, no ETH.
//
// Opt-in: REFUND_KEY_FILE holds the private key of the wallet refunds come from (PAY_TO's own wallet, so
// a refund returns the money that came in, or a separate float). Without it there is no key on the
// node, and a refund is recorded as due for the operator to pay.
//
// Limits, so a stolen status token or a bug cannot empty the wallet: one refund per order (order.js),
// never more than the order's price, at most REFUND_MAX_USD per refund and REFUND_DAILY_MAX_USD per day.
import { readFileSync } from "node:fs";
import { BASE_MAINNET } from "./paywall.js";

const budgetQueues = new Map();

export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/** USD as USDC's six-decimal units, from a decimal string ("0.31" → "310000"), without float rounding. */
export function usdcUnits(usd) {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(String(usd).trim());
  if (!m) throw new Error(`not an amount: ${usd}`);
  return (BigInt(m[1]) * 1_000_000n + BigInt((m[2] || "").padEnd(6, "0"))).toString();
}

/**
 * The payment terms of one refund: the x402 "exact" requirements a payer would see, with the
 * refunded buyer as the receiver.
 */
export function refundTerms({ to, usd }) {
  return {
    scheme: "exact", network: BASE_MAINNET, amount: usdcUnits(usd), asset: USDC_BASE, payTo: to,
    maxTimeoutSeconds: 300, extra: { name: "USD Coin", version: "2" },
  };
}

/**
 * → { address, pay({to, usd, reference}) → {transaction} } or null when not configured.
 * `facilitator` and `signer` are for tests; in production they come from the CDP key and the key file.
 */
export async function buildRefunder({ keyFile, cdpKeyFile, publicUrl = "", maxUsd = 50, dailyMaxUsd = 50,
                                      facilitator = null, signer = null, budgetStore = null, now = () => Date.now(), log = console }) {
  if (!signer && !keyFile) return null;
  if (!budgetStore?.get || !budgetStore?.put) throw new Error("automatic refunds require a durable budgetStore (get/put)");
  if (![maxUsd, dailyMaxUsd].every(n => Number.isFinite(Number(n)) && Number(n) >= 0)) throw new Error("refund limits must be finite non-negative amounts");
  const perRefund = BigInt(usdcUnits(maxUsd)), perDay = BigInt(usdcUnits(dailyMaxUsd));
  let account = signer;
  if (!account) {
    const key = readFileSync(keyFile, "utf8").trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("REFUND_KEY_FILE must hold a 0x-prefixed private key");
    const { privateKeyToAccount } = await import("viem/accounts");
    account = privateKeyToAccount(key);
  }
  if (!facilitator) {
    if (!cdpKeyFile) throw new Error("refunds go through the CDP facilitator: CDP_KEY_FILE is needed too");
    const cdp = JSON.parse(readFileSync(cdpKeyFile, "utf8"));
    const { createCdpFacilitatorClient } = await import("@coinbase/cdp-sdk/x402");
    facilitator = createCdpFacilitatorClient({ apiKeyId: cdp.id, apiKeySecret: cdp.privateKey });
  }
  const [{ x402Client }, { ExactEvmScheme }] = await Promise.all([import("@x402/core/client"), import("@x402/evm")]);
  const client = new x402Client().register(BASE_MAINNET, new ExactEvmScheme(account));
  const ledgerKey = `refund-budget:${account.address.toLowerCase()}`;
  const queueKey = budgetStore.lockKey || budgetStore;
  const serial = (work) => {
    const run = (budgetQueues.get(queueKey) || Promise.resolve()).then(work);
    budgetQueues.set(queueKey, run.catch(() => {}));
    return run;
  };

  return {
    address: account.address,
    pay({ to, usd, reference }) { return serial(async () => {
      if (!/^0x[0-9a-fA-F]{40}$/.test(String(to))) throw new Error("a refund goes to an address");
      if (to.toLowerCase() === account.address.toLowerCase()) throw new Error("the refund wallet cannot refund itself");
      const amount = BigInt(usdcUnits(usd));
      if (!(amount > 0n) || amount > perRefund) throw new Error(`refund of ${usd} USD is above REFUND_MAX_USD (${maxUsd})`);
      const day = new Date(now()).toISOString().slice(0, 10);
      if (!reference) throw new Error("a refund needs a stable reference");
      const ledger = await budgetStore.get(ledgerKey) || { days: {}, refunds: {} };
      const previous = ledger.refunds[reference];
      if (previous) {
        if (previous.to !== to.toLowerCase() || previous.units !== amount.toString()) throw new Error("refund reference has different terms");
        if (previous.result) return previous.result;
        throw new Error("refund already reserved; reconcile its settlement before retrying");
      }
      const spent = BigInt(ledger.days[day] || "0");
      if (spent + amount > perDay) throw new Error(`refunds today would pass REFUND_DAILY_MAX_USD (${dailyMaxUsd})`);
      // Reserve before the first external call. Unknown outcomes remain reserved across restarts.
      ledger.days[day] = (spent + amount).toString();
      ledger.refunds[reference] = { to: to.toLowerCase(), units: amount.toString(), day, status: "reserved" };
      await budgetStore.put(ledgerKey, ledger);
      const terms = refundTerms({ to, usd });
      const payload = await client.createPaymentPayload({
        x402Version: 2,
        resource: { url: `${String(publicUrl).replace(/\/+$/, "")}/refund#${reference}`, description: `Refund of eSIM ${reference}`,
                    mimeType: "application/json" },
        accepts: [terms],
      });
      const verified = await facilitator.verify(payload, terms);
      if (!verified?.isValid) throw new Error(`the facilitator refused the refund: ${verified?.invalidReason || "invalid"}`);
      ledger.refunds[reference].nonce = payload.payload?.authorization?.nonce ?? null;
      await budgetStore.put(ledgerKey, ledger);
      const settled = await facilitator.settle(payload, terms);
      if (!settled?.success) throw new Error(`the refund did not settle: ${settled?.errorReason || "unknown"}`);
      log.info?.(`refund of ${usd} USDC for ${reference} to ${to}: ${settled.transaction}`);
      // The authorization's nonce and wallet: what a signed refund receipt names, so a hub can
      // find this very transfer on chain (aimarket-hub deliveries.py).
      const result = { transaction: settled.transaction, nonce: payload.payload?.authorization?.nonce ?? null, from: account.address };
      ledger.refunds[reference].result = result;
      ledger.refunds[reference].status = "refunded";
      await budgetStore.put(ledgerKey, ledger);
      return result;
    }); },
  };
}
