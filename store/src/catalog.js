// The store's view of the supplier's catalogue: offers at the store's prices, cached, and the countries
// they cover. Built on the rails' offers, so the store and the seller node read plans the same way.
import { offersFromPlans, quote } from "../../rails/src/offers.js";
import { asSupplier } from "../../rails/src/supplier.js";

export const POPULAR = ["FR", "ES", "IT", "DE", "GB", "US", "TR", "TH", "JP", "AE", "PT", "GR", "ID", "VN", "GE", "EG", "KR", "MX"];

export function createCatalog({ supplier: configured, pricing = {}, ttlMs = 15 * 60_000, now = () => Date.now(), log = console }) {
  const supplier = asSupplier(configured);
  let cat = { at: 0, offers: [], byId: new Map(), countries: new Map() };
  let loading = null;

  function index(offers) {
    const countries = new Map();
    for (const o of offers) {
      for (const cc of o.coverage.countries) {
        const c = countries.get(cc) || { code: cc, plans: 0, from_usd: Infinity };
        c.plans += 1;
        if (o.data_gb >= 1) c.from_usd = Math.min(c.from_usd, Number(o.price.usd));
        countries.set(cc, c);
      }
    }
    return countries;
  }

  async function load() {
    if (now() - cat.at < ttlMs && cat.offers.length) return cat;
    loading ??= (async () => {
      try {
        const offers = offersFromPlans(await supplier.catalog(), pricing);
        cat = { at: now(), offers, byId: new Map(offers.map((o) => [o.offer_id, o])), countries: index(offers) };
      } catch (err) {
        if (!cat.offers.length || now() - cat.at > 6 * 3_600_000) throw err;
        log.warn?.(`catalogue refresh failed (${err.code || err.message}); keeping the one from ${new Date(cat.at).toISOString()}`);
      } finally { loading = null; }
      return cat;
    })();
    return loading;
  }

  return {
    load,
    byId: (id) => cat.byId.get(String(id)) ?? null,
    async countries() {
      const c = await load();
      return [...c.countries.values()].map((x) => ({ ...x, from_usd: Number.isFinite(x.from_usd) ? x.from_usd.toFixed(2) : null }));
    },
    async country(cc, filters = {}) {
      const c = await load();
      if (!c.countries.has(String(cc).toUpperCase())) return null;
      return quote(c.offers, { ...filters, country: cc, limit: 50 });
    },
  };
}
