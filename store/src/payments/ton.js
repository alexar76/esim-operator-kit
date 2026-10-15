// TON: USD₮ (the jetton) or TON itself, sent by the buyer from any TON wallet — Tonkeeper, Telegram's
// Wallet, MyTonWallet — through TON Connect or a ton:// link. The order is found on chain by its
// comment: a transfer to the store's address, with the order's memo, of at least the asked amount.
//
// USD₮ is priced 1:1 with the order. TON is priced from tonapi's rate plus a small buffer and the
// amount is fixed in the intent, so a buyer pays what the page showed. Pushed payments arrive before
// delivery, so the storefront checks the wholesale balance before it shows an address at all.
import { Address, beginCell, toNano } from "@ton/core";

export const USDT_MASTER = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";   // USD₮ on TON, 6 decimals
const USDT_RAW = Address.parse(USDT_MASTER).toRawString();
const JETTON_TRANSFER = 0x0f8a7ea5;

export const commentCell = (text) => beginCell().storeUint(0, 32).storeStringTail(text).endCell();

/** The body a buyer's USD₮ wallet needs to send `units` to `to`, with the order's memo as the comment. */
export function jettonTransferBody({ units, to, responseTo, memo, queryId = 0n }) {
  return beginCell()
    .storeUint(JETTON_TRANSFER, 32)
    .storeUint(queryId, 64)
    .storeCoins(BigInt(units))
    .storeAddress(Address.parse(to))
    .storeAddress(Address.parse(responseTo))
    .storeBit(0)                       // no custom payload
    .storeCoins(1n)                    // 1 nanoton forwarded: makes the store's wallet see the comment
    .storeBit(1)                       // forward payload in a reference
    .storeRef(commentCell(memo))
    .endCell();
}

export function tonPay({ address, api = "https://tonapi.io", apiKey = "", fetchImpl = globalThis.fetch,
                         now = () => Date.now(), rateBufferPct = 1.5 }) {
  const store = address ? Address.parse(address) : null;
  const friendly = store ? store.toString({ bounceable: false }) : "";
  const raw = store ? store.toRawString() : "";
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  const get = async (path) => {
    const res = await fetchImpl(`${api}${path}`, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`tonapi ${res.status}`);
    return res.json();
  };

  return {
    id: "ton",
    kind: "push",
    label: "TON · USD₮ or TON",
    assets: ["USDT", "TON"],
    enabled: () => Boolean(store),

    async tonPerUsd() {
      const d = await get("/v2/rates?tokens=ton&currencies=usd");
      const usd = Number(d?.rates?.TON?.prices?.USD);
      if (!(usd > 0)) throw new Error("no TON rate");
      return usd;
    },

    /** The fixed terms of one payment: asset, amount in its smallest unit, memo, and how to send it. */
    async intent(order, { asset = "USDT" } = {}) {
      const memo = order.memo;
      if (asset === "USDT") {
        const units = String(order.price_cents * 10_000);
        const out = {
          method: "ton", asset, to: friendly, memo, units, decimals: 6,
          amount_display: `${(order.price_cents / 100).toFixed(2)} USD₮`,
          jetton: USDT_MASTER,
          deeplink: `ton://transfer/${friendly}?jetton=${USDT_MASTER}&amount=${units}&text=${encodeURIComponent(memo)}`,
        };
        out.uri = out.deeplink;
        return out;
      }
      if (asset === "TON") {
        const rate = await this.tonPerUsd();
        const ton = (order.price_cents / 100 / rate) * (1 + rateBufferPct / 100);
        const nano = toNano(ton.toFixed(9)).toString();
        return {
          method: "ton", asset, to: friendly, memo, units: nano, decimals: 9, rate_usd: rate,
          amount_display: `${(Number(nano) / 1e9).toFixed(4)} TON`,
          deeplink: `ton://transfer/${friendly}?amount=${nano}&text=${encodeURIComponent(memo)}`,
          uri: `ton://transfer/${friendly}?amount=${nano}&text=${encodeURIComponent(memo)}`,
          ton_connect: { validUntil: Math.floor(order.expires_at / 1000),
                         messages: [{ address: friendly, amount: nano,
                                      payload: commentCell(memo).toBoc().toString("base64") }] },
        };
      }
      throw new Error("asset must be USDT or TON");
    },

    /** The TON Connect message for a USD₮ payment, once the buyer's wallet address is known. */
    async jettonMessage(intent, buyer, validUntil) {
      const owner = Address.parse(buyer);
      const d = await get(`/v2/accounts/${encodeURIComponent(owner.toRawString())}/jettons/${encodeURIComponent(USDT_RAW)}`);
      const wallet = d?.wallet_address?.address;
      if (!wallet) throw new Error("this wallet holds no USD₮");
      if (BigInt(d.balance ?? "0") < BigInt(intent.units)) throw new Error("not enough USD₮ in this wallet");
      return {
        validUntil: Math.floor(validUntil / 1000),
        messages: [{
          address: Address.parse(wallet).toString({ bounceable: true }),
          amount: toNano("0.05").toString(),                        // gas for the jetton transfer; the rest returns
          payload: jettonTransferBody({ units: intent.units, to: friendly, responseTo: owner.toString(), memo: intent.memo })
            .toBoc().toString("base64"),
        }],
      };
    },

    /**
     * Has the payment for `intent` arrived? Looks through the store's recent events for a finished
     * transfer to it with the order's memo. {status: paid, ref, payer, units} | {status: underpaid…} | {status: pending}.
     */
    async find(intent, { since }) {
      let before = null;
      for (let page = 0; page < 5; page++) {
        const d = await get(`/v2/accounts/${encodeURIComponent(raw)}/events?limit=50${before ? `&before_lt=${before}` : ""}`);
        const events = Array.isArray(d?.events) ? d.events : [];
        for (const e of events) {
          if (e.timestamp * 1000 < since) return { status: "pending" };
          if (e.in_progress) continue;
          for (const a of e.actions || []) {
            if (a.status !== "ok") continue;
            const t = a.type === "JettonTransfer" && intent.asset === "USDT" ? a.JettonTransfer
                    : a.type === "TonTransfer" && intent.asset === "TON" ? a.TonTransfer : null;
            if (!t || t.recipient?.address !== raw || String(t.comment ?? "").trim() !== intent.memo) continue;
            if (intent.asset === "USDT" && t.jetton?.address !== USDT_RAW) continue;
            const got = BigInt(String(t.amount ?? "0"));
            const ref = `ton:${e.event_id}`;
            if (got < BigInt(intent.units)) return { status: "underpaid", ref, payer: t.sender?.address, units: got.toString() };
            return { status: "paid", ref, payer: t.sender?.address, units: got.toString() };
          }
        }
        if (!events.length || !d.next_from) return { status: "pending" };
        before = d.next_from;
      }
      return { status: "pending" };
    },
  };
}
