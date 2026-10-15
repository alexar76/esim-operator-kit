// The supplier's catalogue, remembered on disk. When the supplier cannot be reached (an outage, a
// restart during one, or, for a demo, an account that no longer answers), the last catalogue it gave
// is served instead of none.
//
// A seller serves the remembered one for at most `maxAgeMs`, six hours by default: wholesale prices
// move, and an order still needs the supplier. A demo sells nothing, so it may serve it for as long
// as it has to (maxAgeMs: Infinity). The file holds your costs: it stays in the node's data folder,
// readable by the node only.
import { asSupplier } from "./supplier.js";

const SIX_HOURS = 6 * 3_600_000;

/**
 * `supplier` with a catalogue that survives the supplier: every catalogue it gives is written to
 * `file`; when catalog() fails, the file answers if it is young enough. `info()` says where the
 * catalogue now comes from: {source: "live" | "snapshot", at: ISO time of that catalogue}.
 */
export function snapshotCatalog(configured, { file, fs, maxAgeMs = SIX_HOURS, now = () => Date.now(), log = console }) {
  const supplier = asSupplier(configured);
  let state = { source: "live", at: null };

  async function remember(plans) {
    if (!file || !fs) return;
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ version: 1, at: new Date(now()).toISOString(), plans }), { mode: 0o600 });
    await fs.rename(tmp, file);
  }

  async function recall() {
    if (!file || !fs) throw new Error("no snapshot file");
    const doc = JSON.parse(await fs.readFile(file, "utf8"));
    const at = Date.parse(doc?.at);
    if (doc?.version !== 1 || !Number.isFinite(at) || !Array.isArray(doc.plans) || !doc.plans.length) throw new Error("unreadable");
    return { at, plans: doc.plans };
  }

  return {
    kind: supplier.kind,
    async catalog() {
      try {
        const plans = await supplier.catalog();
        if (state.source !== "live") log.warn?.("the supplier answers again: the catalogue is live");
        state = { source: "live", at: new Date(now()).toISOString() };
        await remember(plans).catch((err) => log.warn?.(`could not remember the catalogue: ${err.code || err.message}`));
        return plans;
      } catch (err) {
        let saved;
        try { saved = await recall(); } catch { throw err; }
        if (now() - saved.at > maxAgeMs) throw err;
        const at = new Date(saved.at).toISOString();
        if (state.source !== "snapshot") log.warn?.(`the supplier does not answer (${err.code || err.message}); serving the catalogue from ${at}`);
        state = { source: "snapshot", at };
        return saved.plans;
      }
    },
    order: (...a) => supplier.order(...a),
    profiles: (...a) => supplier.profiles(...a),
    cancel: (...a) => supplier.cancel(...a),
    balance: (...a) => supplier.balance(...a),
    info: () => ({ ...state }),
  };
}
