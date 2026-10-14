// esim.order@v1 and esim.status@v1 on a seller node: buy one profile from the wholesaler for a paid
// order, hand the activation code to the payer, and keep nothing that would let anyone else install it.
//
// - One payment, one profile. The wholesaler's transactionId is derived from the payment alone, so a
//   retry after a lost answer finds the same order instead of buying a second profile, and one
//   payment cannot buy two different offers.
// - The activation code (LPA string) and QR link go to the payer in the answer and are never
//   stored, logged or signed into anything public. The node keeps the order and profile numbers;
//   the payer gets a status token (an HMAC of the profile number) and can read the profile again.
// - Delivered before paid: the node settles the payment only after the profile exists. When the
//   settlement fails, release() cancels the profile — unused profiles are refunded by the supplier.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { SupplierError } from "./esimaccess.js";

/** The wholesaler's transaction id for a payment: one payment is one order, whatever offer it names. */
export function transactionIdFor(paymentRef) {
  if (!paymentRef) throw new Error("an order needs the payment it is bought with");
  return "mm" + createHash("sha256").update(`esim-rails/v1|${paymentRef}`).digest("hex").slice(0, 40);
}

export function statusToken(secret, esimTranNo) {
  return createHmac("sha256", secret).update(`esim-status/v1|${esimTranNo}`).digest("base64url");
}

export function tokenMatches(secret, esimTranNo, token) {
  const want = Buffer.from(statusToken(secret, esimTranNo));
  const got = Buffer.from(String(token || ""));
  return got.length === want.length && timingSafeEqual(got, want);
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

function delivery(profile, secret) {
  return {
    order_no: profile.orderNo,
    esim_tran_no: profile.esimTranNo,
    iccid: profile.iccid,
    activation_code: profile.ac,
    qr_code_url: profile.qrCodeUrl || null,
    install_url: profile.shortUrl || null,
    apn: profile.apn || null,
    expires: profile.expiredTime || null,
    status_token: statusToken(secret, profile.esimTranNo),
  };
}

/** The profile an order produced, once the supplier has allocated it (up to ~30 s after ordering). */
async function allocated(client, orderNo, { maxWaitMs, sleep, now }) {
  const until = now() + maxWaitMs;
  let wait = 1_500;
  for (;;) {
    try {
      const list = await client.profiles({ orderNo });
      const p = list.find((x) => x && x.ac && x.esimTranNo);
      if (p) return p;
    } catch (err) {
      if (!(err instanceof SupplierError) || !err.retryable) throw err;
    }
    if (now() + wait > until) return null;
    await sleep(wait);
    wait = Math.min(wait * 1.5, 6_000);
  }
}

/**
 * Buy one profile of `offer` for the payment `paymentRef`. Returns the delivery for the payer, or
 * throws: SupplierError when the wholesaler refused (nothing was bought), or an Error with
 * code "allocation_pending" when the order exists but the profile is not ready yet — the caller
 * must not settle then, and the same payment retried later finds the same order.
 */
export async function fulfil({ client, store, secret, offer, paymentRef,
                               maxWaitMs = 45_000, sleep = sleepMs, now = () => Date.now() }) {
  const transactionId = transactionIdFor(paymentRef);
  let record = await store.get(transactionId);
  if (!record) {
    const placed = await client.order({ transactionId, slug: offer.offer_id, priceUnits: offer._wholesale_units });
    record = { transactionId, orderNo: placed.orderNo, offerId: offer.offer_id, at: new Date(now()).toISOString() };
    await store.put(transactionId, record);
  }
  const profile = record.esimTranNo
    ? (await client.profiles({ esimTranNo: record.esimTranNo })).find((x) => x && x.ac)
    : await allocated(client, record.orderNo, { maxWaitMs, sleep, now });
  if (!profile) {
    const err = new Error("the supplier is still allocating this profile; retry with the same payment");
    err.code = "allocation_pending";
    throw err;
  }
  if (!record.esimTranNo) {
    await store.put(transactionId, { ...record, esimTranNo: profile.esimTranNo, iccid: profile.iccid });
  }
  return { transactionId, delivery: delivery(profile, secret) };
}

/** Undo a delivered order whose payment did not settle: cancel the unused profile (refunded by the supplier). */
export async function release({ client, store, transactionId }) {
  const record = await store.get(transactionId);
  if (!record?.esimTranNo) return false;
  await client.cancel({ esimTranNo: record.esimTranNo });
  await store.put(transactionId, { ...record, released: true });
  return true;
}

/** esim.status@v1: the profile's state and usage for whoever holds its status token. */
export async function status({ client, secret, esimTranNo, token }) {
  if (!/^[0-9A-Za-z]{6,40}$/.test(String(esimTranNo || "")) || !tokenMatches(secret, esimTranNo, token)) {
    const err = new Error("unknown profile or wrong status token");
    err.code = "not_found";
    throw err;
  }
  const [p] = await client.profiles({ esimTranNo });
  if (!p) {
    const err = new Error("the supplier has no such profile");
    err.code = "not_found";
    throw err;
  }
  return {
    esim_tran_no: p.esimTranNo,
    state: p.esimStatus,                 // GOT_RESOURCE (new), IN_USE, USED_UP, CANCEL, …
    installed: p.smdpStatus === "ENABLED" || p.smdpStatus === "DISABLED",
    data_used_bytes: Number(p.orderUsage) || 0,
    data_total_bytes: Number(p.totalVolume) || null,
    activated: p.activateTime || null,
    expires: p.expiredTime || null,
    ...delivery(p, secret),
  };
}

/** A store that keeps order records in a JSON file, one write at a time. Never holds an activation code. */
export function fileStore(path, fs) {
  let chain = Promise.resolve();
  const read = async () => {
    try { return JSON.parse(await fs.readFile(path, "utf8")); } catch { return {}; }
  };
  return {
    get: async (id) => (await read())[id] ?? null,
    put: (id, record) => {
      const { activation_code: _a, ac: _b, qr_code_url: _c, ...safe } = record;
      chain = chain.then(async () => {
        const all = await read();
        all[id] = safe;
        await fs.writeFile(`${path}.tmp`, JSON.stringify(all), { mode: 0o600 });
        await fs.rename(`${path}.tmp`, path);
      });
      return chain;
    },
  };
}
