#!/usr/bin/env node
// A reference for the operator's side of the HTTP supplier (spec/supplier-http.md): the five
// endpoints the kit calls, over an in-memory stock of profiles. Copy its shape into your own system
// — your provisioning, your SIM inventory, your billing — in whatever language you run.
//
//   SUPPLIER_SECRET=… node examples/operator-backend.mjs 9600
//   then run the kit with SUPPLIER=http SUPPLIER_URL=http://127.0.0.1:9600 and the same secret in a file.
import express from "express";
import { randomBytes } from "node:crypto";
import { verifySupplierRequest } from "../src/http-supplier.js";

/** The operator's system as an Express app. `plans` and `stock` stand in for your own database. */
export function operatorBackend({ secret, plans, now = () => Date.now(), allocateAfterMs = 0 }) {
  const orders = new Map();      // transaction_id → {order_ref, plan_id, at}
  const profiles = new Map();    // profile_id → profile
  const app = express();
  app.disable("x-powered-by");
  // Every request must carry the kit's signature over the exact bytes it sent.
  app.use(express.raw({ type: "*/*", limit: "64kb" }), (req, res, next) => {
    const ok = verifySupplierRequest({ secret, timestamp: req.get("x-kit-timestamp"), signature: req.get("x-kit-signature"),
                                       method: req.method, path: req.originalUrl, body: req.body?.length ? req.body.toString("utf8") : "", now: now() });
    if (!ok) return res.status(401).json({ error: "bad_signature" });
    req.json = req.body?.length ? JSON.parse(req.body.toString("utf8")) : {};
    return next();
  });

  app.get("/catalog", (_req, res) => res.json({ plans }));

  app.post("/orders", (req, res) => {
    const { transaction_id: tx, plan_id: planId, cost_usd: cost } = req.json;
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return res.status(409).json({ error: "unknown_plan" });
    // The cost the kit quoted at must still be your cost: a moved price is a "no", never a charge.
    if (cost != null && Math.abs(Number(cost) - plan.cost_usd) > 1e-9) return res.status(409).json({ error: "price_changed" });
    if (!orders.has(tx)) {                                   // idempotent: the same transaction is the same order
      const ref = `ORD-${randomBytes(5).toString("hex")}`;
      orders.set(tx, { order_ref: ref, plan_id: planId, at: now() });
    }
    return res.json({ order_ref: orders.get(tx).order_ref });
  });

  const madeFor = (o) => {
    if (now() - o.at < allocateAfterMs) return null;          // still being made: the kit polls
    let p = [...profiles.values()].find((x) => x.order_ref === o.order_ref);
    if (!p) {
      const plan = plans.find((x) => x.id === o.plan_id);
      const id = `P${randomBytes(6).toString("hex").toUpperCase()}`;
      p = { profile_id: id, order_ref: o.order_ref, activation_code: `LPA:1$smdp.example.net$${randomBytes(8).toString("hex").toUpperCase()}`,
            iccid: `89000${String(now()).slice(-14)}`, qr_code_url: null, install_url: null, apn: "internet",
            expires: new Date(now() + 180 * 86_400_000).toISOString(), state: "NEW", installed: false,
            data_used_bytes: 0, data_total_bytes: plan.data_bytes, activated: null };
      profiles.set(id, p);
    }
    return p;
  };
  app.get("/profiles", (req, res) => {
    if (req.query.order_ref) {
      const o = [...orders.values()].find((x) => x.order_ref === req.query.order_ref);
      const p = o ? madeFor(o) : null;
      return res.json({ profiles: p ? [p] : [] });
    }
    const p = profiles.get(String(req.query.profile_id || ""));
    return res.json({ profiles: p ? [p] : [] });
  });

  app.post("/profiles/:id/cancel", (req, res) => {
    const p = profiles.get(req.params.id);
    if (!p) return res.status(404).json({ error: "not_found" });
    if (p.installed) return res.status(409).json({ error: "in_use" });
    p.state = "CANCELLED";
    return res.json({ cancelled: true });
  });

  app.get("/balance", (_req, res) => res.json({ usd: 250 }));
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const secret = process.env.SUPPLIER_SECRET || "";
  if (secret.length < 16) { console.error("set SUPPLIER_SECRET (16+ characters)"); process.exit(1); }
  const plans = [
    { id: "FR-3GB-15D", name: "France 3 GB · 15 days", countries: ["FR"], kind: "country", data_bytes: 3 * 1024 ** 3, days: 15, speed: "4G/5G", cost_usd: 1.9 },
    { id: "EU-10GB-30D", name: "Europe 10 GB · 30 days", countries: ["FR", "DE", "ES", "IT", "PT", "NL"], kind: "region", data_bytes: 10 * 1024 ** 3, days: 30, speed: "5G", cost_usd: 6.5 },
  ];
  const port = Number(process.argv[2] || 9600);
  operatorBackend({ secret, plans }).listen(port, "127.0.0.1", () => console.log(`operator backend on http://127.0.0.1:${port}`));
}
