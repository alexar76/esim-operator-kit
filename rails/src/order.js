// esim.order@v1 and esim.status@v1 on a seller node: buy one profile from the supplier for a paid
// order, hand the activation code to the payer, and keep nothing that would let anyone else install it.
//
// - One payment, one profile. The wholesaler's transactionId is derived from the payment alone, so a
//   retry after a lost answer finds the same order instead of buying a second profile, and one
//   payment cannot buy two different offers.
// - The activation code (LPA string) and QR link go to the payer in the answer and are never
//   stored, logged or signed into anything public. The node keeps the order and profile numbers;
//   the payer gets a status token (an HMAC of the profile number) and can read the profile again.
// - Delivered before paid: the node settles the payment only after the profile exists. An uncertain
//   settlement retains the profile for reconciliation; it is never cancelled on a timeout alone.
// - A refund is the payer's to ask for, with the status token, while the eSIM is unused: refund()
//   cancels the profile at the supplier and pays the price back to the address that paid it (refund.js),
//   or records it as due for the operator when the node has no refund wallet.
import { resolve } from "node:path";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { SupplierError, asSupplier } from "./supplier.js";

/** The wholesaler's transaction id for a payment: one payment is one order, whatever offer it names. */
export function transactionIdFor(paymentRef) {
  if (!paymentRef) throw new Error("an order needs the payment it is bought with");
  return "mm" + createHash("sha256").update(`esim-rails/v1|${paymentRef}`).digest("hex").slice(0, 40);
}

export function statusToken(secret, profileId) {
  return createHmac("sha256", secret).update(`esim-status/v1|${profileId}`).digest("base64url");
}

export function tokenMatches(secret, profileId, token) {
  const want = Buffer.from(statusToken(secret, profileId));
  const got = Buffer.from(String(token || ""));
  return got.length === want.length && timingSafeEqual(got, want);
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
// Records written before the supplier interface named things neutrally.
const orderRefOf = (r) => r.orderRef ?? r.orderNo ?? null;
const profileIdOf = (r) => r.profileId ?? r.esimTranNo ?? null;

/** What the payer receives (spec/esim-v1/delivery.schema.json). */
function delivery(p, secret) {
  return {
    order_no: p.orderRef ?? null,
    esim_tran_no: p.profileId,
    iccid: p.iccid ?? null,
    activation_code: p.activationCode,
    qr_code_url: p.qrCodeUrl || null,
    install_url: p.installUrl || null,
    apn: p.apn || null,
    expires: p.expires || null,
    status_token: statusToken(secret, p.profileId),
  };
}

/** The profile an order produced, once the supplier has made it (seconds; up to ~30 s at eSIM Access). */
async function allocated(supplier, orderRef, { maxWaitMs, sleep, now }) {
  const until = now() + maxWaitMs;
  let wait = 1_500;
  for (;;) {
    try {
      const list = await supplier.profiles({ orderRef });
      const p = list.find((x) => x && x.activationCode && x.profileId);
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
 * throws: SupplierError when the supplier refused (nothing was bought), or an Error with
 * code "allocation_pending" when the order exists but the profile is not ready yet — the caller
 * must not settle then, and the same payment retried later finds the same order.
 * `supplier` is a supplier.js Supplier (an eSIM Access client is wrapped; `client` is its old name).
 */
export async function fulfil({ supplier, client, store, secret, offer, paymentRef,
                               maxWaitMs = 45_000, sleep = sleepMs, now = () => Date.now(), recovery = null }) {
  const sup = asSupplier(supplier ?? client);
  const transactionId = transactionIdFor(paymentRef);
  let record = await store.get(transactionId);
  if (!record) {
    // A durable intent precedes the external purchase. If its response is lost,
    // recovery uses the same supplier transaction id, never a second purchase.
    record = { ...recovery, transactionId, orderRef: null, procurement: "ordering", costUsd: offer._cost_usd,
               offerId: offer.offer_id, at: new Date(now()).toISOString(),
               payer: String(paymentRef).split(":")[0] || null, nonce: String(paymentRef).split(":")[1] || null,
               priceUsd: offer.price?.usd ?? null };
    await store.put(transactionId, record);
  }
  if (record.offerId !== offer.offer_id || record.released || record.refund) {
    throw Object.assign(new Error("payment belongs to a different or closed order"), { code: "order_closed" });
  }
  if (!orderRefOf(record)) {
    try {
      const placed = await sup.order({ transactionId, planId: record.offerId, costUsd: record.costUsd });
      record = { ...record, orderRef: placed.orderRef, procurement: "ordered" };
      await store.put(transactionId, record);
    } catch (err) {
      if (err instanceof SupplierError && !err.retryable) {
        await store.put(transactionId, { ...record, procurement: "rejected" });
      }
      throw err;
    }
  }
  const known = profileIdOf(record);
  const profile = known
    ? (await sup.profiles({ profileId: known })).find((x) => x && x.activationCode)
    : await allocated(sup, orderRefOf(record), { maxWaitMs, sleep, now });
  if (!profile) {
    const err = new Error("the supplier is still allocating this profile; retry with the same payment");
    err.code = "allocation_pending";
    throw err;
  }
  if (!known) {
    await store.put(transactionId, { ...record, profileId: profile.profileId, iccid: profile.iccid ?? null });
    // The status token names the profile, not the payment: this finds the order a refund is asked for.
    await store.put(`profile:${profile.profileId}`, { transactionId });
  }
  return { transactionId, delivery: delivery({ ...profile, orderRef: profile.orderRef ?? orderRefOf(record) }, secret) };
}

/** Undo a delivered order whose payment did not settle: cancel the unused profile (refunded by the supplier). */
export async function release({ supplier, client, store, transactionId }) {
  let record = await store.get(transactionId);
  if (!record) return false;
  if (record.released) return true;
  const sup = asSupplier(supplier ?? client);
  if (record.procurement === "rejected") {
    await store.put(transactionId, { ...record, released: true });
    return true;
  }
  if (!orderRefOf(record) && !profileIdOf(record)) {
    // Resolve a lost supplier response by its idempotency key. Only called
    // after finalized proof that the buyer's payment cannot land.
    const placed = await sup.order({ transactionId, planId: record.offerId, costUsd: record.costUsd });
    record = { ...record, orderRef: placed.orderRef, procurement: "ordered" };
    await store.put(transactionId, record);
  }
  const profiles = await sup.profiles(profileIdOf(record)
    ? { profileId: profileIdOf(record) } : { orderRef: orderRefOf(record) });
  const profile = profiles.find(p => p?.profileId);
  if (!profile) return false; // Allocation still pending: recovery must keep trying.
  if (!["CANCEL", "CANCELLED", "CANCELED"].includes(profile.state)) {
    await sup.cancel({ profileId: profile.profileId });
  }
  record = { ...record, profileId: profile.profileId };
  await store.put(transactionId, { ...record, released: true });
  return true;
}

const fail = (code, message) => Object.assign(new Error(message), { code });
const refunding = new Map();   // transactionId → the refund in flight: a second ask waits for the same answer

/**
 * A refund the payer asks for: the holder of the status token, while the eSIM is unused (not installed,
 * no data spent). The profile is cancelled at the supplier, which refunds the operator's balance; then
 * the price goes back to the address that paid, through `refunder` (refund.js), once per order. Without
 * a refunder, or when its payment fails, the refund is recorded as due and the operator pays it.
 * → {status: "refunded" | "due" | "paying", amount_usd, to, transaction?, at}
 * Throws: not_found (a token or a profile this node did not sell), in_use (installed or used).
 */
export async function refund({ supplier, client, store, secret, esimTranNo, token, refunder = null, now = () => Date.now() }) {
  if (!/^[0-9A-Za-z_-]{6,64}$/.test(String(esimTranNo || "")) || !tokenMatches(secret, esimTranNo, token)) {
    throw fail("not_found", "unknown profile or wrong status token");
  }
  const pointer = await store.get(`profile:${esimTranNo}`);
  const transactionId = pointer?.transactionId;
  if (!transactionId) throw fail("not_found", "no order of this node bought that profile");
  if (!refunding.has(transactionId)) {
    refunding.set(transactionId, refundOnce({ supplier: supplier ?? client, store, transactionId, esimTranNo, refunder, now })
      .finally(() => refunding.delete(transactionId)));
  }
  return refunding.get(transactionId);
}

async function refundOnce({ supplier, store, transactionId, esimTranNo, refunder, now }) {
  let record = await store.get(transactionId);
  if (!record) throw fail("not_found", "no order of this node bought that profile");
  if (record.settlement && record.settlement.status !== "settled") throw fail("settlement_pending", "reconcile the payment before refunding");
  // Once per order. A payment that failed is not tried again by itself: its transfer may still have
  // landed, so the operator checks the chain first.
  if (record.refund && (record.refund.status !== "due" || record.refund.attempted)) return record.refund;
  const sup = asSupplier(supplier);
  if (!record.released) {
    const [p] = await sup.profiles({ profileId: esimTranNo });
    if (p && (p.installed || Number(p.dataUsedBytes) > 0 || ["IN_USE", "USED_UP"].includes(p.state))) {
      throw fail("in_use", "this eSIM was installed or has used data: it cannot be refunded");
    }
    try {
      await sup.cancel({ profileId: esimTranNo });
    } catch (err) {
      if (err instanceof SupplierError && !err.retryable) throw fail("in_use", `the supplier will not cancel this eSIM (${err.code})`);
      throw err;
    }
    record = { ...record, released: true };
    await store.put(transactionId, record);
  }
  const base = { amount_usd: record.priceUsd ?? null, to: record.payer ?? null, at: new Date(now()).toISOString(),
                 delivery_nonce: record.nonce ?? null };
  let result = { status: "due", ...base };
  if (refunder && base.amount_usd && /^0x[0-9a-fA-F]{40}$/.test(base.to || "")) {
    // Written before the money moves: a crash in between leaves "paying", which is never paid again.
    await store.put(transactionId, { ...record, refund: { status: "paying", ...base } });
    try {
      const paid = await refunder.pay({ to: base.to, usd: base.amount_usd, reference: esimTranNo });
      result = { status: "refunded", ...base, transaction: paid.transaction, refund_from: paid.from ?? null, refund_nonce: paid.nonce ?? null };
    } catch (err) {
      result = { status: "due", ...base, attempted: true, error: String(err.message || err).slice(0, 200) };
    }
  }
  await store.put(transactionId, { ...record, refund: result });
  return result;
}

/** esim.status@v1: the profile's state and usage for whoever holds its status token. */
export async function status({ supplier, client, secret, esimTranNo, token }) {
  if (!/^[0-9A-Za-z_-]{6,64}$/.test(String(esimTranNo || "")) || !tokenMatches(secret, esimTranNo, token)) {
    const err = new Error("unknown profile or wrong status token");
    err.code = "not_found";
    throw err;
  }
  const [p] = await asSupplier(supplier ?? client).profiles({ profileId: esimTranNo });
  if (!p) {
    const err = new Error("the supplier has no such profile");
    err.code = "not_found";
    throw err;
  }
  return {
    esim_tran_no: p.profileId,
    state: p.state ?? null,               // eSIM Access: GOT_RESOURCE (new), IN_USE, USED_UP, CANCEL, …
    installed: Boolean(p.installed),
    data_used_bytes: Number(p.dataUsedBytes) || 0,
    data_total_bytes: Number(p.dataTotalBytes) || null,
    activated: p.activated ?? null,
    expires: p.expires ?? null,
    ...delivery(p, secret),
  };
}

/** A store that keeps order records in a JSON file, one write at a time. Never holds an activation code. */
export function fileStore(path, fs) {
  let chain = Promise.resolve();
  const read = async () => {
    try {
      const data = JSON.parse(await fs.readFile(path, "utf8"));
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("order store must be a JSON object");
      return data;
    } catch (err) { if (err.code === "ENOENT") return {}; throw err; }
  };
  return {
    lockKey: resolve(path),
    all: async () => Object.values(await read()),
    get: async (id) => (await read())[id] ?? null,
    put: (id, record) => {
      const { activation_code: _a, ac: _b, qr_code_url: _c, ...safe } = record;
      chain = chain.catch(() => {}).then(async () => {
        const all = await read();
        all[id] = safe;
        await fs.writeFile(`${path}.tmp`, JSON.stringify(all), { mode: 0o600 });
        await fs.rename(`${path}.tmp`, path);
      });
      return chain;
    },
  };
}
