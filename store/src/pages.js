// The store's pages, rendered on the server: home, a page per country (what people search for —
// "esim france", "esim япония"), and the order page where a buyer pays and gets the eSIM. The
// browser script (public/store.js) adds the interactive parts: the plan filter, checkout, wallets,
// and the order's live status. Everything a page needs from the server is in one JSON data block.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { LANGS, HTML_LANG, STRINGS, countryName, flag } from "./i18n.js";
import { POPULAR } from "./catalog.js";

const asset = (rel) => {
  const body = readFileSync(new URL(`../public/${rel}`, import.meta.url));
  return { body, version: createHash("sha256").update(body).digest("hex").slice(0, 12) };
};
export const ASSETS = {
  "store.css": { ...asset("store.css"), type: "text/css; charset=utf-8" },
  "store.js": { ...asset("store.js"), type: "text/javascript; charset=utf-8" },
};

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
const fill = (t, vars) => String(t).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
const jsonBlock = (v) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")
  .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

export const pathFor = (lang, rest = "") => (lang === "en" ? "/" : `/${lang}/`) + rest;

function shell({ lang, store, title, description, path, alternates, body, data, origin, robots = "index,follow" }) {
  const t = STRINGS[lang];
  const links = alternates
    ? alternates.map(([l, p]) => `<link rel="alternate" hreflang="${HTML_LANG[l]}" href="${esc(origin + p)}">`).join("")
      + `<link rel="alternate" hreflang="x-default" href="${esc(origin + alternates[0][1])}">` : "";
  const langs = (alternates || LANGS.map((l) => [l, pathFor(l)])).map(([l, p]) =>
    `<a href="${esc(p)}" lang="${HTML_LANG[l]}"${l === lang ? ' aria-current="true"' : ""}>${esc(STRINGS[l].name)}</a>`).join("");
  return `<!doctype html>
<html lang="${HTML_LANG[lang]}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="${store.demo && robots.startsWith("index") ? "index,follow" : robots}">
<link rel="canonical" href="${esc(origin + path)}">
${links}
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta name="theme-color" content="#0b6e4f">
<link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/store.css?v=${ASSETS["store.css"].version}">
<script src="/assets/store.js?v=${ASSETS["store.js"].version}" defer></script>
</head>
<body${store.demo ? ' class="demo"' : ""}>
${store.demo ? `<div class="demo-bar" role="note">${esc(t.demoBanner)}${store.kitUrl ? ` <a href="${esc(store.kitUrl)}">${esc(t.demoCta)} →</a>` : ""}</div>` : ""}
<header class="top">
<a class="brand" href="${esc(pathFor(lang))}"><span class="logo" aria-hidden="true">◎</span>${esc(store.name)}</a>
<details class="langs"><summary>${esc(t.name)}</summary><nav>${langs}</nav></details>
</header>
<main id="main">
${body}
</main>
<footer class="foot"><p>${esc(t.footer)}</p><p>${esc(store.name)}${store.contact ? ` · <a href="mailto:${esc(store.contact)}">${esc(store.contact)}</a>` : ""}`
  + `${store.termsUrl ? ` · <a href="${esc(store.termsUrl)}">${esc(t.terms)}</a>` : ""}${store.privacyUrl ? ` · <a href="${esc(store.privacyUrl)}">${esc(t.privacy)}</a>` : ""}</p></footer>
<script type="application/json" id="page-data">${jsonBlock({ lang, ...data })}</script>
</body>
</html>
`;
}

const card = (lang, c) => {
  const t = STRINGS[lang];
  return `<a class="dest" href="${esc(pathFor(lang, `c/${c.code.toLowerCase()}`))}"><span class="flag" aria-hidden="true">${flag(c.code)}</span>`
    + `<span class="dname">${esc(countryName(lang, c.code))}</span>`
    + (c.from_usd ? `<span class="dfrom">${esc(t.from)} $${esc(c.from_usd)}</span>` : "") + `</a>`;
};

export function homePage(lang, { store, origin, countries }) {
  const t = STRINGS[lang];
  const known = new Map(countries.map((c) => [c.code, c]));
  const popular = POPULAR.filter((cc) => known.has(cc)).map((cc) => card(lang, known.get(cc))).join("");
  const sorted = [...countries].sort((a, b) => countryName(lang, a.code).localeCompare(countryName(lang, b.code), HTML_LANG[lang]));
  const all = sorted.map((c) => `<li><a href="${esc(pathFor(lang, `c/${c.code.toLowerCase()}`))}">${flag(c.code)} ${esc(countryName(lang, c.code))}</a></li>`).join("");
  const options = sorted.map((c) => `<option value="${esc(countryName(lang, c.code))}" data-code="${c.code}"></option>`).join("");
  const steps = t.steps.map(([h, p], i) => `<li><b>${i + 1}</b><h3>${esc(h)}</h3><p>${esc(p)}</p></li>`).join("");
  const body = `<section class="hero">
<h1>${esc(t.tagline)}</h1>
<p class="lead">${esc(t.lead)}</p>
<form class="search" action="${esc(pathFor(lang))}" role="search">
<label class="sr" for="q">${esc(t.search)}</label>
<input id="q" name="q" list="countries" placeholder="${esc(t.search)}" autocomplete="off" aria-describedby="qh">
<datalist id="countries">${options}</datalist>
<span id="qh" class="sr">${esc(t.searchHint)}</span>
</form>
</section>
<section><h2>${esc(t.popular)}</h2><div class="dests">${popular}</div></section>
<section class="how"><h2>${esc(t.how)}</h2><ol class="steps">${steps}</ol><p class="note">${esc(t.compat)}</p></section>
<section><h2>${esc(t.all)}</h2><ul class="all">${all}</ul></section>`;
  return shell({ lang, store, origin, title: `${store.name} — ${t.tagline}`, description: t.lead, path: pathFor(lang),
                 alternates: LANGS.map((l) => [l, pathFor(l)]), body,
                 data: { page: "home", countries: sorted.map((c) => [c.code, countryName(lang, c.code)]) } });
}

/** "France · 3 GB · 15 days", in the page's language — the supplier's own plan names are English. */
export function planLabel(lang, o, place) {
  const t = STRINGS[lang];
  const where = o.coverage.kind === "country" ? place : fill(t.region, { n: o.coverage.countries.length });
  const data = o.data_gb >= 1 ? `${o.data_gb} ${t.gb}` : `${Math.round(o.data_gb * 1024)} MB`;
  return `${where} · ${data} · ${o.days} ${t.days}`;
}

const noteKey = (o) => (o.id.startsWith("evm:") ? "evm" : o.id === "tron-usdt" ? "tron" : o.id === "sol-usdc" ? "solana" : o.id);

/** The checkout's payment options, one row per network with its tokens as choices. */
function paymentChoices(lang, options) {
  const t = STRINGS[lang];
  const nets = new Map();
  for (const o of options) { if (!nets.has(o.network)) nets.set(o.network, []); nets.get(o.network).push(o); }
  let first = true;
  return [...nets].map(([net, opts]) => `<div class="net"><span class="netname">${esc(net === "Card" ? t.card : net)}</span><span class="toks">`
    + opts.map((o) => {
      const c = first ? " checked" : "";
      first = false;
      return `<label class="tok"><input type="radio" name="method" value="${esc(o.id)}" data-note="${esc(t.methodNote[noteKey(o)] || "")}"${c}>`
        + `<span>${esc(o.token === "Card" ? t.card : o.token)}${o.gasless ? ` · ${esc(t.noGas)}` : ""}</span></label>`;
    }).join("") + `</span></div>`).join("");
}

export function countryPage(lang, cc, { store, origin, offers, options }) {
  const t = STRINGS[lang];
  const name = countryName(lang, cc);
  const rest = `c/${cc.toLowerCase()}`;
  const plan = (o) => `<li class="plan" data-gb="${o.data_gb}" data-days="${o.days}">
<div class="pmain"><span class="pgb">${o.data_gb >= 1 ? o.data_gb : Math.round(o.data_gb * 1024) + " MB"}${o.data_gb >= 1 ? ` ${esc(t.gb)}` : ""}</span>
<span class="pdays">${o.days} ${esc(t.days)}</span></div>
<div class="pmeta">${esc(o.coverage.kind === "country" ? fill(t.country, { country: name }) : fill(t.region, { n: o.coverage.countries.length }))}`
    + `${o.speed ? ` · ${esc(o.speed.replace(/\//g, " / "))}` : ""}${o.top_up ? ` · ${esc(t.topUp)}` : ""}</div>
<div class="pbuy"><span class="price">$${esc(o.price.usd)}</span><span class="pergb">$${o.usd_per_gb.toFixed(2)} ${esc(t.perGb)}</span>
<button type="button" class="buy" data-offer="${esc(o.offer_id)}" data-name="${esc(planLabel(lang, o, name))}" data-price="${esc(o.price.usd)}">${esc(t.buy)}</button></div>
</li>`;
  const body = `<section class="hero small">
<p class="crumbs"><a href="${esc(pathFor(lang))}">${esc(store.name)}</a></p>
<h1><span aria-hidden="true">${flag(cc)}</span> ${esc(fill(t.plansFor, { country: name }))}</h1>
<p class="lead">${esc(fill(t.plansLead, { country: name }))}</p>
</section>
<section>
<form class="filters" aria-label="${esc(t.filterGb)}">
<label>${esc(t.filterGb)} <select name="gb"><option value="0">${esc(t.any)}</option>${[1, 3, 5, 10, 20].map((g) => `<option value="${g}">${g}+ ${esc(t.gb)}</option>`).join("")}</select></label>
<label>${esc(t.filterDays)} <select name="days"><option value="0">${esc(t.any)}</option>${[7, 15, 30].map((d) => `<option value="${d}">${d}+ ${esc(t.days)}</option>`).join("")}</select></label>
</form>
<ul class="plans">${offers.map(plan).join("")}</ul>
<p class="empty" hidden>${esc(t.noPlans)}</p>
<p class="note">${esc(t.compat)}</p>
</section>
<dialog id="checkout" aria-labelledby="co-h"><form method="dialog" class="co">
<h2 id="co-h">${esc(t.checkout)}</h2>
<p class="co-plan"></p>
<fieldset><legend>${esc(t.payWith)}</legend>
${paymentChoices(lang, options)}
<p class="m-note" id="m-note"></p>
</fieldset>
<div class="co-foot">
<p class="co-err" role="alert" hidden></p>
<div class="co-actions"><button type="button" class="ghost" value="cancel" data-close>×</button><button type="button" class="go" data-go>${esc(t.continue)}</button></div>
</div>
</form></dialog>`;
  const ld = { "@context": "https://schema.org", "@type": "Product", name: fill(t.plansFor, { country: name }),
    description: fill(t.plansLead, { country: name }),
    offers: { "@type": "AggregateOffer", priceCurrency: "USD", offerCount: offers.length,
      lowPrice: offers.length ? Math.min(...offers.map((o) => Number(o.price.usd))).toFixed(2) : undefined,
      highPrice: offers.length ? Math.max(...offers.map((o) => Number(o.price.usd))).toFixed(2) : undefined } };
  return shell({ lang, store, origin, title: `${fill(t.plansFor, { country: name })} · ${store.name}`,
                 description: `${fill(t.plansLead, { country: name })} ${t.tagline}`, path: pathFor(lang, rest),
                 alternates: LANGS.map((l) => [l, pathFor(l, rest)]),
                 body: body + `<script type="application/ld+json">${jsonBlock(ld)}</script>`,
                 data: { page: "country", country: cc, strings: { errors: t.errors, demoCta: t.demoCta },
                         kit_url: store.demo ? store.kitUrl || "" : "" } });
}

export function orderPage(lang, id, { store, origin, tonManifest }) {
  const t = STRINGS[lang];
  const body = `<section class="order" id="order" aria-live="polite">
<p class="crumbs"><a href="${esc(pathFor(lang))}">${esc(store.name)}</a> · ${esc(t.order)} <code>${esc(id)}</code></p>
<p class="save">${esc(t.saveLink)}</p>
<div id="order-body"><p class="muted">…</p></div>
</section>`;
  const { name: _n, steps: _s, ...ui } = t;
  return shell({ lang, store, origin, title: `${t.order} · ${store.name}`, description: t.lead, path: pathFor(lang, `o/${id}`),
                 robots: "noindex,nofollow", body, data: { page: "order", id, ui, ton_manifest: tonManifest } });
}

export function notFound(lang, { store, origin }) {
  const t = STRINGS[lang];
  return shell({ lang, store, origin, title: `404 · ${store.name}`, description: t.lead, path: pathFor(lang), robots: "noindex",
                 body: `<section class="hero small"><h1>404</h1><p><a href="${esc(pathFor(lang))}">${esc(store.name)}</a></p></section>`,
                 data: { page: "404" } });
}

export function sitemap(origin, countries) {
  const urls = ["", ...countries.map((c) => `c/${c.code.toLowerCase()}`)].map((rest) => {
    const alts = LANGS.map((l) => `<xhtml:link rel="alternate" hreflang="${HTML_LANG[l]}" href="${esc(origin + pathFor(l, rest))}"/>`).join("");
    return LANGS.map((l) => `<url><loc>${esc(origin + pathFor(l, rest))}</loc>${alts}</url>`).join("\n");
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`;
}
