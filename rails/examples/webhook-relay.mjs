#!/usr/bin/env node
// A ready receiver for the kit's webhooks: checks each event's signature and posts a line about it
// to a Telegram chat and/or a Slack channel. Run it beside the kit, point WEBHOOK_URL at it.
//
//   WEBHOOK_SECRET=…  TELEGRAM_BOT_TOKEN=…  TELEGRAM_CHAT_ID=…  SLACK_WEBHOOK_URL=…  node examples/webhook-relay.mjs 9700
//   then in the kit's .env: WEBHOOK_URL=http://127.0.0.1:9700/hooks/esim and the same secret in secrets/webhook_secret
import express from "express";
import { verifyWebhook } from "../src/webhooks.js";

const LINES = {
  "order.created": (d) => `🛒 New order ${d.order_id}: ${d.offer_name} — $${d.price_usd} (${d.method})`,
  "order.delivered": (d) => `✅ Delivered ${d.order_id}: ${d.offer_name} — $${d.price_usd}, cost $${d.cost_usd != null ? Number(d.cost_usd).toFixed(2) : "?"}`,
  "order.refund_due": (d) => `⚠️ Refund due ${d.order_id}: paid $${d.price_usd} via ${d.method}, supplier said ${d.error}. Payer ${d.payment?.payer ?? "?"}`,
  "order.underpaid": (d) => `⚠️ Underpaid ${d.order_id}: ${d.payment?.units ?? "?"} units for $${d.price_usd}`,
  "order.expired": (d) => `⌛ Expired ${d.order_id}`,
  "agent_order.delivered": (d) => `🤖 Agent bought ${d.offer_id} — $${d.price_usd} from ${d.payer}`,
  "agent_order.settlement_pending": (d) => `🤖 Payment needs reconciliation; do not charge again (${d.payment_ref})`,
};

export function relay({ secret, telegram, slackUrl, fetchImpl = globalThis.fetch, log = console }) {
  const app = express();
  app.post("/hooks/esim", express.text({ type: "*/*", limit: "64kb" }), async (req, res) => {
    if (!verifyWebhook({ secret, timestamp: req.get("x-kit-timestamp"), signature: req.get("x-kit-signature"), body: req.body })) return res.sendStatus(401);
    const event = JSON.parse(req.body);
    const line = (LINES[event.type] || ((d) => `${event.type}: ${JSON.stringify(d)}`))(event.data || {});
    const sends = [];
    if (telegram?.token && telegram?.chat) {
      sends.push(fetchImpl(`https://api.telegram.org/bot${telegram.token}/sendMessage`, { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: telegram.chat, text: line, disable_web_page_preview: true }) }));
    }
    if (slackUrl) sends.push(fetchImpl(slackUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: line }) }));
    const results = await Promise.allSettled(sends);
    if (results.some((r) => r.status === "rejected" || !r.value.ok)) { log.warn?.(`relay: a destination refused ${event.type}`); return res.sendStatus(502); }
    return res.sendStatus(204);      // a 502 makes the kit retry; a 204 is final
  });
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const secret = process.env.WEBHOOK_SECRET || "";
  if (secret.length < 16) { console.error("set WEBHOOK_SECRET (16+ characters, the same as the kit's)"); process.exit(1); }
  const app = relay({ secret, telegram: { token: process.env.TELEGRAM_BOT_TOKEN, chat: process.env.TELEGRAM_CHAT_ID }, slackUrl: process.env.SLACK_WEBHOOK_URL });
  const port = Number(process.argv[2] || 9700);
  app.listen(port, "127.0.0.1", () => console.log(`webhook relay on http://127.0.0.1:${port}/hooks/esim`));
}
