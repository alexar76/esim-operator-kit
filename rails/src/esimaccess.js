// eSIM Access Open API client (https://docs.esimaccess.com): the wholesale side of a seller node.
//
// Every request is signed: RT-AccessCode, RT-RequestID (a UUID), RT-Timestamp (ms) and
// RT-Signature = lowercase hex HMAC-SHA256(Timestamp + RequestID + AccessCode + body, SecretKey).
// There is no sandbox: tests run against recorded responses, and a live test order is cancelled
// (an unused profile is refunded to the balance). The API allows 8 requests a second.
//
// The two keys never leave this module: they are read from files, sent only to the supplier's
// own host, and never appear in an error, a log line or a return value.
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

export const DEFAULT_BASE = "https://api.esimaccess.com";
/** Prices come as integers: 10 000 units = 1.00 of currencyCode (USD). */
export const PRICE_UNITS = 10_000;

export function sign({ timestamp, requestId, accessCode, body, secretKey }) {
  return createHmac("sha256", secretKey).update(`${timestamp}${requestId}${accessCode}${body}`).digest("hex");
}

export class SupplierError extends Error {
  constructor(code, message, { status = 0, retryable = false } = {}) {
    super(message);
    this.code = String(code);
    this.status = status;
    this.retryable = retryable;
  }
}

/** Codes that mean "not yet" or "try later" rather than "no". */
const RETRYABLE = new Set(["000001", "200010"]);   // server error; SM-DP+ still allocating

export function keysFromFiles({ accessCodeFile, secretKeyFile }) {
  const read = (f, what) => {
    if (!f) throw new Error(`${what} file is not configured`);
    const v = readFileSync(f, "utf8").trim();
    if (!/^[A-Za-z0-9_-]{4,200}$/.test(v)) throw new Error(`${what} file does not hold a key`);
    return v;
  };
  return { accessCode: read(accessCodeFile, "access code"), secretKey: read(secretKeyFile, "secret key") };
}

export function createClient({ accessCode, secretKey, base = DEFAULT_BASE, fetchImpl = globalThis.fetch,
                               timeoutMs = 20_000, now = () => Date.now(), uuid = randomUUID } = {}) {
  if (!accessCode || !secretKey) throw new Error("eSIM Access needs an access code and a secret key");
  const root = base.replace(/\/+$/, "");

  async function call(path, payload = {}) {
    const body = JSON.stringify(payload);
    const timestamp = String(now());
    const requestId = uuid().replace(/-/g, "");
    let res;
    try {
      res = await fetchImpl(`${root}/api/v1/open/${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "RT-AccessCode": accessCode,
          "RT-RequestID": requestId,
          "RT-Timestamp": timestamp,
          "RT-Signature": sign({ timestamp, requestId, accessCode, body, secretKey }),
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new SupplierError("unreachable", "the supplier did not answer", { retryable: true });
    }
    let doc = null;
    try { doc = await res.json(); } catch { doc = null; }
    if (!res.ok || !doc) {
      throw new SupplierError(`http_${res.status}`, `the supplier answered HTTP ${res.status}`,
                              { status: res.status, retryable: res.status === 429 || res.status >= 500 });
    }
    if (doc.success !== true && doc.success !== "true") {
      const code = String(doc.errorCode ?? "unknown");
      const text = String(doc.errorMsg ?? doc.errorMessage ?? "refused").slice(0, 200);
      throw new SupplierError(code, text, { status: res.status, retryable: RETRYABLE.has(code) });
    }
    return doc.obj ?? {};
  }

  return {
    /** Fixed data plans (dataType 1) for a country (ISO alpha-2), "!RG" regional or "!GL" global; all when empty. */
    async packages({ location = "", dataType = "1" } = {}) {
      const obj = await call("package/list", { locationCode: location, type: "BASE", dataType });
      return Array.isArray(obj.packageList) ? obj.packageList : [];
    },
    /**
     * One profile of one plan. `transactionId` makes it idempotent: the supplier treats a repeated
     * id as the same order, so a retry after a lost answer cannot buy twice. `priceUnits` is
     * checked by the supplier: a plan that changed price since the quote is refused, not charged.
     */
    async order({ transactionId, slug, priceUnits }) {
      if (!/^[A-Za-z0-9_-]{8,50}$/.test(transactionId || "")) throw new Error("transactionId must be 8-50 safe characters");
      const item = { packageCode: slug, count: 1, ...(Number.isInteger(priceUnits) ? { price: priceUnits } : {}) };
      const obj = await call("esim/order", {
        transactionId, packageInfoList: [item], ...(Number.isInteger(priceUnits) ? { amount: priceUnits } : {}),
      });
      return { orderNo: obj.orderNo ?? null, transactionId: obj.transactionId ?? transactionId };
    },
    /** The profiles of an order (or one profile): throws a retryable 200010 while still allocating. */
    async profiles({ orderNo, esimTranNo }) {
      const obj = await call("esim/query", {
        ...(orderNo ? { orderNo } : {}), ...(esimTranNo ? { esimTranNo } : {}), pager: { pageNum: 1, pageSize: 20 },
      });
      return Array.isArray(obj.esimList) ? obj.esimList : [];
    },
    /** Cancel an unused, uninstalled profile: the supplier refunds it to the balance. */
    async cancel({ esimTranNo }) {
      await call("esim/cancel", { esimTranNo });
      return true;
    },
    async usage({ esimTranNo }) {
      const obj = await call("esim/usage/query", { esimTranNoList: [esimTranNo] });
      return Array.isArray(obj.esimUsageList) ? obj.esimUsageList[0] ?? null : null;
    },
    /** The wholesale balance, in the supplier's units. */
    async balance() {
      const obj = await call("balance/query", {});
      return { units: Number(obj.balance ?? 0), updated: obj.lastUpdateTime ?? null };
    },
  };
}
