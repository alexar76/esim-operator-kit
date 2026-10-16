// The x402 paywall in front of POST /order: the offer's own price, USDC on Base, paid to the seller,
// through Coinbase's CDP facilitator. Same stack as the AIMarket gateway (okx-a2mcp/src/x402.js).
//
// The price is dynamic: it is read from the request's offer_id (src/node.js has already refused an
// unknown one). The middleware verifies the payment, runs the order, settles only when the order
// answered below 400, and releases the buffered answer — the activation code — only after a
// successful settlement. An uncertain outcome is recorded by onSettleFailure for reconciliation.
import { createBaseReconciler } from "./reconcile.js";
import { readFileSync } from "node:fs";

export const BASE_MAINNET = "eip155:8453";

export async function buildPaywall({ cdpKeyFile, payTo, publicUrl, priceOf, onSettleFailure, onSettled, reconciler = createBaseReconciler(), log = console }) {
  if (!cdpKeyFile || !/^0x[0-9a-fA-F]{40}$/.test(payTo || "")) return null;
  if (typeof onSettleFailure !== "function" || typeof onSettled !== "function") {
    throw new Error("buildPaywall requires onSettleFailure and onSettled for durable payment outcomes");
  }
  const key = JSON.parse(readFileSync(cdpKeyFile, "utf8"));
  const [{ createX402Server }, { paymentMiddlewareFromHTTPServer }] = await Promise.all([
    import("@coinbase/cdp-sdk/x402"),
    import("@x402/express"),
  ]);
  const routes = {
    "POST /order": {
      accepts: {
        scheme: "exact",
        network: BASE_MAINNET,
        payTo,
        price: (ctx) => {
          const usd = priceOf(ctx.adapter.getBody?.()?.offer_id);
          if (!usd) throw new Error("unknown offer");
          return `$${usd}`;
        },
      },
      resource: `${String(publicUrl).replace(/\/+$/, "")}/order`,
      description: "One travel data eSIM, bought from this seller's wholesale account: send offer_id from esim.quote, pay the offer's price in USDC on Base, get the activation code (LPA), QR link, ICCID and a status token. Charged only when the profile is delivered.",
      mimeType: "application/json",
      serviceName: "esim-rails",
      tags: ["esim", "travel", "mobile-data", "roaming"],
    },
  };
  const server = await createX402Server({
    apiKeyId: key.id,
    apiKeySecret: key.privateKey,
    environment: "production",
    payToConfig: { type: "address", evm: payTo },
    routes,
  });
  // A refused payment says why in the 402 it gets back; the operator sees it here too (never the payload).
  server.resourceServer.onVerifyFailure(async (ctx) => {
    log.warn?.(`payment refused at verification: ${String(ctx.error?.message || "unknown").slice(0, 200)}`);
  });
  server.resourceServer.onAfterSettle(async (ctx) => {
    await onSettled?.(ctx.paymentPayload, ctx.result);
  });
  server.resourceServer.onSettleFailure(async (ctx) => {
    try {
      await onSettleFailure(ctx.paymentPayload);
      log.warn?.("settlement requires reconciliation; profile retained and payment retry blocked");
    } catch (err) {
      log.error?.(`settlement failure could not be recorded: ${err.code || err.message}`);
    }
  });
  return { middleware: paymentMiddlewareFromHTTPServer(server), payTo, tracksSettlement: true, reconciler };
}
