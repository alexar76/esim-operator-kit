// The storefront's HTTP side: pages in five languages, the order API the browser script talks to,
// Stripe's webhook, and what TON Connect needs (its manifest and the wallet bundle).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import { LANGS, countryName } from "./i18n.js";
import { EVM_CHAINS } from "./payments/evm.js";
import { KIT_PAGES, KIT_REPO } from "./kit.js";

// The kit's guide pages, from the one list in kit.js: /kit, /kit/rails, … /kit/cases.
const KIT_SLUGS = Object.keys(KIT_PAGES).filter(Boolean).join("|");
import { ASSETS, MERMAID_VERSION, countryPage, homePage, kitPage, notFound, orderPage, pathFor, sitemap } from "./pages.js";

const TONCONNECT_UI = fileURLToPath(new URL("../node_modules/@tonconnect/ui/dist/tonconnect-ui.min.js", import.meta.url));
const MERMAID = fileURLToPath(new URL("../node_modules/mermaid/dist/mermaid.min.js", import.meta.url));
const ICON_SVG = readFileSync(new URL("../public/icon.svg", import.meta.url));
const ICON_PNG = readFileSync(new URL("../public/icon-180.png", import.meta.url));

// TON Connect talks to wallet bridges and loads wallet icons from their hosts, and its UI sets inline
// styles: hence https:/wss: for connections and images, and inline styles. Scripts stay this origin.
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' https: data:",
  "connect-src 'self' https: wss:", "font-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'",
].join("; ");

/** The order networks are listed in on the checkout. */
const NETWORK_ORDER = ["Base", "Tron", "TON", "Solana", "Ethereum", "Arbitrum One", "BNB Chain", "Polygon", "OP Mainnet", "Avalanche C-Chain", "Card"];

/** A checkout option id → the payment method and the asset it pays in. */
export function resolveOption(id) {
  const fixed = { "usdc-base": ["usdc-base"], "ton-usdt": ["ton", "USDT"], "ton-ton": ["ton", "TON"],
                  "tron-usdt": ["tron"], "sol-usdc": ["solana"], stripe: ["stripe"] };
  if (fixed[id]) return fixed[id];
  const m = /^evm:(\d{1,6}):(USDC|USDT)$/.exec(String(id));
  return m ? ["evm", { chainId: Number(m[1]), token: m[2] }] : null;
}

/** The options a method offers on the checkout: {id, network, token}. */
export function optionsOf(m) {
  if (m.options) return m.options();
  if (m.id === "usdc-base") return [{ id: "usdc-base", network: "Base", token: "USDC", gasless: true }];
  if (m.id === "ton") return [{ id: "ton-usdt", network: "TON", token: "USD₮" }, { id: "ton-ton", network: "TON", token: "TON" }];
  if (m.id === "stripe") return [{ id: "stripe", network: "Card", token: "Card" }];
  return [];
}
const byNetwork = (a, b) => NETWORK_ORDER.indexOf(a.network) - NETWORK_ORDER.indexOf(b.network);

/** Every crypto option, for the demo's checkout: what an operator's store can offer. */
export const DEMO_OPTIONS = [
  { id: "usdc-base", network: "Base", token: "USDC", gasless: true },
  { id: "tron-usdt", network: "Tron", token: "USDT" },
  { id: "ton-usdt", network: "TON", token: "USD₮" }, { id: "ton-ton", network: "TON", token: "TON" },
  { id: "sol-usdc", network: "Solana", token: "USDC" },
  ...Object.entries(EVM_CHAINS).flatMap(([cid, c]) => Object.keys(c.tokens).map((tok) => ({ id: `evm:${cid}:${tok}`, network: c.name, token: tok }))),
];

/**
 * `kit`: the rendered guides (src/kit.js loadKit) the demo store serves at /kit, or null.
 * `kitOrigin`: where the guides are published when another host serves them (the kit's landing
 * proxies /kit to this store); their canonical links point there, and this store's sitemap leaves them out.
 */
export function createApp({ store, origin, catalog, orders, methods, allow = () => true, demoOptions = [], kit = null, kitOrigin = origin }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback, uniquelocal");
  const html = (res, status, body, cache = "public, max-age=300") => res.status(status).set({
    "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin", "Cache-Control": cache,
  }).send(body);
  // In demo mode every crypto option is shown (from `demoOptions`), and every payment route answers "demo mode".
  const uiOptions = () => {
    const all = store.demo ? demoOptions : methods.filter((m) => m.enabled()).flatMap(optionsOf);
    // Base USDC twice (gasless signature and plain transfer) would only confuse: the gasless one wins.
    const gasless = all.some((o) => o.id === "usdc-base");
    return all.filter((o) => !(gasless && o.id === "evm:8453:USDC")).slice().sort(byNetwork);
  };
  const demoOff = (_req, res, next) => (store.demo
    ? res.status(403).json({ error: "demo_mode", message: "demo mode: payments are off" }) : next());
  const ctx = { store: kit ? { ...store, kitPages: true } : store, origin };
  const KIT_RESTS = kit && kitOrigin === origin ? Object.keys(KIT_PAGES).map((p) => (p ? `kit/${p}` : "kit")) : [];

  // Stripe signs the raw body: this route reads it before any JSON parser does.
  app.post("/api/stripe/webhook", (req, res, next) => (store.demo ? res.status(403).end() : next()),
    express.raw({ type: "*/*", limit: "256kb" }), async (req, res) => {
    const r = await orders.cardPaid(req.body.toString("utf8"), req.get("stripe-signature") || "");
    return res.status(r.error === "bad_signature" ? 400 : 200).json(r.error ? { error: r.error } : { received: true });
  });
  app.use(express.json({ limit: "16kb" }));

  app.get("/assets/:file", (req, res) => {
    if (req.params.file === "tonconnect-ui.min.js") {
      return res.set("Cache-Control", "public, max-age=86400").type("text/javascript").sendFile(TONCONNECT_UI);
    }
    if (req.params.file === "mermaid.min.js" && kit) {
      return res.set("Cache-Control", req.query.v === MERMAID_VERSION ? "public, max-age=31536000, immutable" : "public, max-age=300")
        .type("text/javascript").sendFile(MERMAID);
    }
    if (req.params.file === "icon.svg") return res.type("image/svg+xml").set("Cache-Control", "public, max-age=86400").send(ICON_SVG);
    if (req.params.file === "icon-180.png") return res.type("image/png").set("Cache-Control", "public, max-age=86400").send(ICON_PNG);
    const a = ASSETS[req.params.file];
    if (!a) return res.status(404).end();
    return res.set({ "Content-Type": a.type, "Cache-Control": req.query.v === a.version ? "public, max-age=31536000, immutable" : "public, max-age=300" }).send(a.body);
  });
  app.get("/tonconnect-manifest.json", (_req, res) =>
    res.set("Access-Control-Allow-Origin", "*").json({ url: origin, name: store.name, iconUrl: `${origin}/assets/icon-180.png` }));
  app.get("/robots.txt", (_req, res) => res.type("text/plain").send(`User-agent: *\nAllow: /\nDisallow: /o/\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`));
  app.get("/sitemap.xml", async (_req, res) => {
    try { return res.type("application/xml").send(sitemap(origin, await catalog.countries(), KIT_RESTS)); } catch { return res.status(503).end(); }
  });

  // ── API ────────────────────────────────────────────────────────────────────────────────
  const limited = (req, res, next) => (allow(`${req.ip}|${req.path.split("/")[2]}`) ? next()
    : res.status(429).set("Retry-After", "60").json({ error: "rate_limited" }));
  const token = (req) => String(req.get("x-order-token") || "");

  app.post("/api/orders", demoOff, limited, async (req, res) => {
    const [methodId, asset] = resolveOption(String(req.body?.method)) || [];
    if (!methodId) return res.status(400).json({ error: "unknown_method" });
    try {
      await catalog.load();
      const r = await orders.create({ offerId: String(req.body?.offer_id || ""), methodId, asset });
      if (r.error) return res.status(r.error === "temporarily_unavailable" ? 503 : 400).json(r);
      return res.status(201).json(r);
    } catch {
      return res.status(503).json({ error: "temporarily_unavailable" });
    }
  });
  app.get("/api/orders/:id", async (req, res) => {
    const o = await orders.get(req.params.id, token(req));
    return o ? res.set("Cache-Control", "no-store").json(o) : res.status(404).json({ error: "not_found" });
  });
  app.post("/api/orders/:id/authorize", demoOff, limited, async (req, res) => {
    const r = await orders.authorize(req.params.id, token(req), req.body || {});
    return res.status(r.error ? (r.error === "not_found" ? 404 : 409) : 200).set("Cache-Control", "no-store").json(r);
  });
  app.post("/api/orders/:id/claim", demoOff, limited, async (req, res) => {
    const r = await orders.claim(req.params.id, token(req), String(req.body?.hash || ""));
    return res.status(r.error ? (r.error === "not_found" ? 404 : 409) : 200).set("Cache-Control", "no-store").json(r);
  });
  app.post("/api/orders/:id/ton-message", demoOff, limited, async (req, res) => {
    try {
      const r = await orders.tonMessage(req.params.id, token(req), String(req.body?.buyer || ""));
      return res.status(r.error ? 404 : 200).json(r);
    } catch (err) {
      return res.status(409).json({ error: "ton_wallet", message: String(err.message).slice(0, 120) });
    }
  });
  app.post("/api/orders/:id/checkout", demoOff, limited, async (req, res) => {
    const lang = LANGS.includes(req.body?.lang) ? req.body.lang : "en";
    const r = await orders.cardCheckout(req.params.id, token(req), `${origin}${pathFor(lang, `o/${req.params.id}`)}`);
    return res.status(r.error ? 404 : 200).json(r);
  });

  // ── Pages: /, /c/fr, /o/<id>, and the same under /ru/, /es/, /fr/, /zh/ ─────────────────
  const strict = express.Router({ strict: true });
  async function page(lang, rest, res) {
    const k = rest.match(new RegExp(`^kit(?:/(${KIT_SLUGS}))?$`));
    if (k) {
      const doc = kit?.get(`${lang}|${k[1] || ""}`);
      return doc ? html(res, 200, kitPage(lang, k[1] || "", { ...ctx, origin: kitOrigin, doc, repo: KIT_REPO })) : html(res, 404, notFound(lang, ctx), "no-store");
    }
    try {
      if (rest === "") return html(res, 200, homePage(lang, { ...ctx, countries: await catalog.countries() }));
      const c = rest.match(/^c\/([a-z]{2})$/);
      if (c) {
        const offers = await catalog.country(c[1].toUpperCase(), { min_gb: 0 });
        if (!offers) return html(res, 404, notFound(lang, ctx), "no-store");
        return html(res, 200, countryPage(lang, c[1].toUpperCase(), { ...ctx, offers, options: uiOptions() }));
      }
      const o = rest.match(/^o\/([A-Za-z0-9_-]{16})$/);
      if (o) return html(res, 200, orderPage(lang, o[1], { ...ctx, tonManifest: `${origin}/tonconnect-manifest.json` }), "no-store");
    } catch {
      return html(res, 503, notFound(lang, ctx), "no-store");
    }
    return html(res, 404, notFound(lang, ctx), "no-store");
  }
  // The home page's search box submits ?q=<country name in the page's language, or its code>.
  async function home(lang, req, res) {
    const q = String(req.query.q || "").trim().toLocaleLowerCase();
    if (q) {
      try {
        const hit = (await catalog.countries()).find((c) => c.code.toLowerCase() === q
          || countryName(lang, c.code).toLocaleLowerCase() === q || countryName("en", c.code).toLowerCase() === q);
        if (hit) return res.redirect(302, pathFor(lang, `c/${hit.code.toLowerCase()}`));
      } catch { /* fall through to the home page */ }
    }
    return page(lang, "", res);
  }
  strict.get("/", (req, res) => home("en", req, res));
  strict.get(/^\/(ru|es|fr|zh)\/$/, (req, res) => home(req.params[0], req, res));
  strict.get(/^\/(ru|es|fr|zh)$/, (req, res) => res.redirect(301, `/${req.params[0]}/`));
  strict.get(new RegExp(`^/(?:(ru|es|fr|zh)/)?((?:c|o)/[A-Za-z0-9_-]+|kit(?:/(?:${KIT_SLUGS}))?)$`), (req, res) => page(req.params[0] || "en", req.params[1], res));
  strict.use((_req, res) => html(res, 404, notFound("en", ctx), "no-store"));
  app.use(strict);
  return app;
}
