// Local preview: node scripts/dev.mjs [port] — the real pages and order flow over a stand-in
// wholesaler (the documented fixtures, copied across popular countries), a facilitator that accepts
// any signature, and a TON watcher that finds every payment after 15 s. No keys, no money.
import * as fsp from "node:fs/promises";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Address } from "@ton/core";
import { fileStore } from "../../rails/src/order.js";
import { createApp, DEMO_OPTIONS } from "../src/app.js";
import { createCatalog, POPULAR } from "../src/catalog.js";
import { loadKit } from "../src/kit.js";
import { createOrders, jsonDb } from "../src/orders.js";
import { usdcBase } from "../src/payments/usdc-base.js";
import { tonPay } from "../src/payments/ton.js";
import { stripeCards } from "../src/payments/stripe.js";
import { evmTransfer } from "../src/payments/evm.js";
import { tronUsdt } from "../src/payments/tron.js";
import { solanaUsdc } from "../src/payments/solana.js";
import QRCode from "qrcode";

const port = Number(process.argv[2] || 9496);
const fx = (n) => JSON.parse(readFileSync(new URL(`../../rails/test/fixtures/${n}`, import.meta.url), "utf8"));
const base = fx("package-list.json").obj.packageList.filter((p) => p.dataType === 1);
const profile = fx("esim-query.json").obj.esimList[0];
const packages = [];
for (const cc of POPULAR) {
  [[1, 7, 6000], [3, 15, 15000], [5, 30, 23000], [10, 30, 39000], [20, 30, 65000]].forEach(([g, d, p], i) => packages.push({
    ...base[1], packageCode: `${cc}${i}`, slug: `${cc}_${g}_${d}`, name: `${cc} ${g}GB ${d}Days`, location: cc,
    volume: g * 1073741824, duration: d, price: p + (cc.charCodeAt(0) % 7) * 500, speed: "4G/5G" }));
}
packages.push(base[2]);
const orders = new Map();
const supplier = {
  packages: async () => packages,
  balance: async () => ({ units: 1_000_000 }),
  order: async ({ transactionId }) => { if (!orders.has(transactionId)) orders.set(transactionId, { orderNo: `B${orders.size + 1}` }); return orders.get(transactionId); },
  profiles: async ({ orderNo, esimTranNo }) => {
    const o = [...orders.values()].find((x) => x.orderNo === orderNo || x.tran === esimTranNo);
    if (!o) return [];
    o.tran ||= `2${o.orderNo.slice(1).padStart(13, "0")}`;
    return [{ ...profile, orderNo: o.orderNo, esimTranNo: o.tran, qrCodeUrl: "/assets/icon.svg" }];
  },
  cancel: async () => true,
};
const storeTon = new Address(0, Buffer.alloc(32, 7)).toString({ bounceable: false });
const ton = tonPay({ address: storeTon, fetchImpl: async (url) => new Response(JSON.stringify(
  url.includes("/rates") ? { rates: { TON: { prices: { USD: 1.37 } } } } : { events: [] })) });
const created = new Map();
ton.find = async (intent, { since }) => (Date.now() - since > 75_000
  ? { status: "paid", ref: `ton:dev-${intent.memo}`, payer: "0:dev", units: intent.units } : { status: "pending" });
// Stand-in networks: an EVM transfer is confirmed when claimed; Tron and Solana find every payment after 75 s.
const evm = evmTransfer({ payTo: "0x1218ff36C5d2e3B6A565CdB1A8B1AcCFc606Ad0a" });
evm.verify = async (intent, hash) => ({ status: "paid", ref: `evm:${intent.chain_id}:${hash}`, payer: "0xdev", units: intent.units });
const tron = tronUsdt({ address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" });
tron.find = async (intent, { since }) => (Date.now() - since > 135_000 ? { status: "paid", ref: `tron:dev-${intent.units}`, payer: "Tdev", units: intent.units } : { status: "pending" });
const sol = solanaUsdc({ address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", storeName: "Travel eSIM (preview)" });
sol.find = tron.find;
const methods = [
  evm, tron, sol,
  usdcBase({ payTo: "0x1218ff36C5d2e3B6A565CdB1A8B1AcCFc606Ad0a",
             facilitator: { verify: async () => ({ isValid: true }), settle: async () => ({ success: true, transaction: "0xdev" }) } }),
  ton,
  stripeCards({}),
];
const dir = await mkdtemp(join(tmpdir(), "travel-esim-dev-"));
const catalog = createCatalog({ supplier });
const store = createOrders({ db: jsonDb(join(dir, "orders.json"), fsp), supplier, railsStore: fileStore(join(dir, "w.json"), fsp),
                             statusSecret: "dev-status-secret-0123456789", methods, offersById: (id) => catalog.byId(id),
                             qr: (uri) => QRCode.toDataURL(uri, { margin: 1, width: 440 }) });
// DEMO=1 previews the integrators' demo: banner on, payments off.
const demo = process.env.DEMO === "1";
const app = createApp({ store: { name: "Travel eSIM (preview)", demo, kitUrl: demo ? "/kit" : "" },
                        origin: `http://127.0.0.1:${port}`, catalog, orders: store, methods, demoOptions: DEMO_OPTIONS,
                        kit: demo ? loadKit() : null });
await catalog.load();
setInterval(() => store.watch().catch(() => {}), 5_000).unref();
app.listen(port, "127.0.0.1", (err) => {
  if (err) { console.error(`Preview could not listen on port ${port}: ${err.code}`); process.exitCode = 1; return; }
  console.log(`travel-esim preview on http://127.0.0.1:${port}/`);
});
