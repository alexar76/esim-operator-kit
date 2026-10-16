import { privateKeyToAccount } from "viem/accounts";
const claimWallet = privateKeyToAccount("0x" + "01".repeat(32));
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { offersFromEsimAccess } from "../../rails/src/offers.js";
import { fileStore } from "../../rails/src/order.js";
import { createOrders, jsonDb } from "../src/orders.js";
import { decode, encode, isSolanaAddress, isTronAddress } from "../src/payments/base58.js";
import { EVM_CHAINS, evmTransfer, tokenUnits } from "../src/payments/evm.js";
import { tronUsdt, USDT_TRON } from "../src/payments/tron.js";
import { solanaUsdc, USDC_SOLANA } from "../src/payments/solana.js";

// The fixtures' prices below were worked out at a 20 % margin with a $0.30 floor; the default is 100 % and $1.
const PRICING = { marginPct: 20, minMarginUsd: 0.3 };
const rails = (n) => JSON.parse(readFileSync(new URL(`../../rails/test/fixtures/${n}`, import.meta.url), "utf8"));
const OFFERS = offersFromEsimAccess(rails("package-list.json").obj.packageList, PRICING);
const PROFILE = rails("esim-query.json").obj.esimList[0];
const STORE_EVM = "0x1218ff36C5d2e3B6A565CdB1A8B1AcCFc606Ad0a";
const STORE_TRON = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";   // a valid Tron address (the USDT contract) as the store, for tests
const STORE_SOL = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const json = (body) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

function supplier() {
  const orders = new Map();
  return {
    balance: async () => ({ units: 1e9 }),
    order: async ({ transactionId }) => { if (!orders.has(transactionId)) orders.set(transactionId, { orderNo: `B${orders.size + 1}` }); return orders.get(transactionId); },
    profiles: async ({ orderNo, esimTranNo }) => {
      const o = [...orders.values()].find((x) => x.orderNo === orderNo || x.tran === esimTranNo);
      if (!o) return [];
      o.tran ||= `2${o.orderNo.slice(1).padStart(13, "0")}`;
      return [{ ...PROFILE, orderNo: o.orderNo, esimTranNo: o.tran }];
    },
    cancel: async () => true,
  };
}
async function shop(methods, { now = () => Date.now(), qr = null } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "esim-net-"));
  const byId = new Map(OFFERS.map((o) => [o.offer_id, o]));
  return createOrders({ db: jsonDb(join(dir, "o.json"), fs), supplier: supplier(), railsStore: fileStore(join(dir, "r.json"), fs),
                        statusSecret: "net-status-secret-0123456789", methods, offersById: (id) => byId.get(id), now, qr, log: { error() {} } });
}

test("base58 round-trips, and Tron and Solana addresses are checked, checksum included", () => {
  const b = Uint8Array.from([0, 0, 1, 2, 250, 255]);
  assert.deepEqual(decode(encode(b)), b);
  assert.ok(isTronAddress(USDT_TRON));
  assert.ok(!isTronAddress(USDT_TRON.slice(0, -1) + "u"), "a changed last character fails the checksum");
  assert.ok(isSolanaAddress(USDC_SOLANA) && isSolanaAddress(STORE_SOL));
  assert.ok(!isSolanaAddress("0x1218ff36C5d2e3B6A565CdB1A8B1AcCFc606Ad0a"));
  assert.throws(() => tronUsdt({ address: "Tnope" }), /not a Tron address/);
  assert.throws(() => solanaUsdc({ address: "nope" }), /not a Solana address/);
});

/** A JSON-RPC node that knows one transaction. */
function evmNode({ chainId = 56, head = 1000, block = 990, timestamp, receipt }) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (_url, init) => {
      const { method, params } = JSON.parse(init.body);
      calls.push(method);
      if (method === "eth_getTransactionReceipt") return json({ result: receipt === undefined ? null : receipt(params[0]) });
      if (method === "eth_getBlockByNumber") return json({ result: { timestamp: "0x" + Math.floor(timestamp / 1000).toString(16) } });
      if (method === "eth_blockNumber") return json({ result: "0x" + head.toString(16) });
      if (method === "eth_chainId") return json({ result: "0x" + chainId.toString(16) });
      return json({ error: { code: -32601, message: "no" } });
    },
  };
}
const pad = (a) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const transferLog = (token, to, value) => ({ address: token, topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", pad(claimWallet.address), pad(to)], data: "0x" + BigInt(value).toString(16) });

test("EVM: the transfer the wallet sends, with each token's own decimals", () => {
  assert.equal(tokenUnits(540, 6), "5400000");
  assert.equal(tokenUnits(540, 18), "5400000000000000000");
  const m = evmTransfer({ payTo: STORE_EVM });
  const i = m.intent({ price_cents: 540 }, { asset: { chainId: 56, token: "USDT" } });
  assert.equal(i.token_address, EVM_CHAINS[56].tokens.USDT[0]);
  assert.equal(i.units, "5400000000000000000");
  assert.equal(i.tx.to, i.token_address);
  assert.equal(i.tx.data.slice(0, 10), "0xa9059cbb");
  assert.equal("0x" + i.tx.data.slice(34, 74), STORE_EVM.toLowerCase());
  assert.equal(BigInt("0x" + i.tx.data.slice(74)), 5400000000000000000n);
  assert.equal(i.uri, `ethereum:${i.token_address}@56/transfer?address=${STORE_EVM}&uint256=5400000000000000000`);
  assert.equal(m.options().length, 13, "six networks with USDC and USDT, and Base with USDC");
  assert.ok(!m.options().some((o) => o.id === "evm:8453:USDT"));
  assert.throws(() => m.intent({ price_cents: 1 }, { asset: { chainId: 999, token: "USDC" } }), /unknown network/);
});

test("EVM: a hash pays only when it is a confirmed transfer of the token to the store, newer than the order", async () => {
  const since = Date.now() - 60_000;
  const token = EVM_CHAINS[56].tokens.USDT[0];
  const intent = evmTransfer({ payTo: STORE_EVM }).intent({ price_cents: 540 }, { asset: { chainId: 56, token: "USDT" } });
  const hash = "0x" + "aa".repeat(32);
  const check = (opts) => evmTransfer({ payTo: STORE_EVM, fetchImpl: evmNode({ timestamp: Date.now(), ...opts }).fetchImpl }).verify(intent, hash, { since });
  const ok = (logs) => () => ({ status: "0x1", blockNumber: "0x" + (990).toString(16), logs });
  assert.equal((await check({ receipt: ok([transferLog(token, STORE_EVM, intent.units)]) })).status, "paid");
  assert.equal((await check({ receipt: undefined })).status, "pending");
  const confirming = await check({ head: 990, receipt: ok([transferLog(token, STORE_EVM, intent.units)]) });
  assert.deepEqual([confirming.status, confirming.confirming], ["pending", true], "BNB Chain asks 3 confirmations");
  assert.equal((await check({ receipt: () => ({ status: "0x0", blockNumber: "0x1", logs: [] }) })).status, "failed");
  assert.equal((await check({ receipt: ok([transferLog(EVM_CHAINS[56].tokens.USDC[0], STORE_EVM, intent.units)]) })).reason, "no_transfer_to_store");
  assert.equal((await check({ receipt: ok([transferLog(token, "0x" + "cd".repeat(20), intent.units)]) })).reason, "no_transfer_to_store");
  assert.equal((await check({ receipt: ok([transferLog(token, STORE_EVM, BigInt(intent.units) - 1n)]) })).reason, "no_transfer_to_store");
  assert.equal((await check({ timestamp: since - 3_600_000, receipt: ok([transferLog(token, STORE_EVM, intent.units)]) })).reason, "older_than_order");
  assert.equal((await evmTransfer({ payTo: STORE_EVM }).verify(intent, "0x12", { since })).reason, "not_a_hash");
});

test("EVM orders: a claimed hash delivers once confirmed, and one transaction never pays two orders", async () => {
  const token = EVM_CHAINS[42161].tokens.USDC[0];
  let head = 990;
  let paid = "0";
  const node = evmNode({ chainId: 42161, timestamp: Date.now(), receipt: () => ({ status: "0x1", blockNumber: "0x" + (995).toString(16),
    logs: [transferLog(token, STORE_EVM, paid)] }) });
  const fetchImpl = async (u, init) => (JSON.parse(init.body).method === "eth_blockNumber" ? json({ result: "0x" + head.toString(16) }) : node.fetchImpl(u, init));
  const orders = await shop([evmTransfer({ payTo: STORE_EVM, fetchImpl })], { qr: async (uri) => `qr:${uri}` });
  const OFFER_ID = "EU-30_3_7";
  const a = await orders.create({ offerId: OFFER_ID, methodId: "evm", asset: { chainId: 42161, token: "USDC" } });
  paid = a.order.intent.units;                                       // the buyer sends exactly the asked amount
  assert.equal(a.order.intent.qr, `qr:${a.order.intent.uri}`, "the QR code carries the EIP-681 link");
  const hash = "0x" + "bb".repeat(32);
  assert.equal((await orders.claim(a.order.id, a.token, "nope")).error, "not_a_hash");
  const proof = { signature: await claimWallet.signMessage({ message: a.order.intent.claim_message + hash }) };
  const first = await orders.claim(a.order.id, a.token, hash, proof);       // mined in 995, head 990: not confirmed
  assert.equal(first.order.status, "awaiting_payment");
  assert.equal(first.order.claim.hash, hash);
  const b = await orders.create({ offerId: OFFER_ID, methodId: "evm", asset: { chainId: 42161, token: "USDC" } });
  assert.equal((await orders.claim(b.order.id, b.token, hash)).error, "payer_signature_required", "a public pending hash alone reserves nothing");
  head = 1000;
  await orders.watch();
  const done = await orders.get(a.order.id, a.token);
  assert.equal(done.status, "delivered");
  assert.equal(done.payment.ref, `evm:42161:${hash}`);
  assert.equal(done.esim.activation_code, PROFILE.ac);
  assert.equal((await orders.claim(b.order.id, b.token, hash)).error, "used", "nor once it has paid");
});

test("Tron: every open order asks its own exact amount, and is found by it among confirmed USDT transfers", async () => {
  let n = 0;
  const seq = [7, 7, 7, 42];                                        // the second order's first draws collide
  const transfers = [];
  const fetchImpl = async (url) => {
    assert.match(url, new RegExp(`/v1/accounts/${STORE_TRON}/transactions/trc20\\?only_to=true&only_confirmed=true`));
    return json({ success: true, data: transfers });
  };
  const m = tronUsdt({ address: STORE_TRON, fetchImpl, uniq: () => seq[Math.min(n++, seq.length - 1)] });
  const orders = await shop([m]);
  const a = await orders.create({ offerId: "ES_5_30", methodId: "tron" });
  const b = await orders.create({ offerId: "ES_5_30", methodId: "tron" });
  assert.equal(a.order.intent.units, "5400007");
  assert.equal(b.order.intent.units, "5400042", "a colliding amount is drawn again");
  assert.equal(a.order.intent.amount_display, "5.400007 USDT");
  const t = (value, id) => ({ transaction_id: id, token_info: { address: USDT_TRON, decimals: 6 }, block_timestamp: Date.now(),
                              from: "TZ9DpMasFbi65n3NJikCgW5vUvhcUQmXz6", to: STORE_TRON, type: "Transfer", value: String(value) });
  transfers.push(t(5400000, "x1"), t(5400042, "x2"));                // a round amount pays nobody
  await orders.watch();
  assert.equal((await orders.get(a.order.id, a.token)).status, "awaiting_payment");
  const pb = await orders.get(b.order.id, b.token);
  assert.equal(pb.status, "delivered");
  assert.equal(pb.payment.ref, "tron:x2");
});

test("Solana: a Solana Pay link with a fresh reference, and a payment found by that reference", async () => {
  let sig = "5j7s1QzqC9JkVk9ZZ7x";
  let txAmount = 5400000n;
  const fetchImpl = async (_u, init) => {
    const { method, params } = JSON.parse(init.body);
    if (method === "getSignaturesForAddress") return json({ result: [{ signature: sig, err: null, blockTime: Math.floor(Date.now() / 1000) }] });
    if (method === "getTransaction") return json({ result: { meta: { err: null,
      preTokenBalances: [{ accountIndex: 2, mint: USDC_SOLANA, owner: STORE_SOL, uiTokenAmount: { amount: "1000" } }],
      postTokenBalances: [{ accountIndex: 2, mint: USDC_SOLANA, owner: STORE_SOL, uiTokenAmount: { amount: String(1000n + txAmount) } }] },
      transaction: { message: { accountKeys: [{ pubkey: "Buyer111", signer: true }] } } } });
    return json({ error: { code: -1 } });
  };
  const m = solanaUsdc({ address: STORE_SOL, fetchImpl, storeName: "Test" });
  const orders = await shop([m]);
  const a = await orders.create({ offerId: "ES_5_30", methodId: "solana" });
  const u = new URL(a.order.intent.uri.replace("solana:", "solana://"));
  assert.equal(u.searchParams.get("amount"), "5.40");
  assert.equal(u.searchParams.get("spl-token"), USDC_SOLANA);
  assert.ok(isSolanaAddress(u.searchParams.get("reference")));
  await orders.watch();
  const pa = await orders.get(a.order.id, a.token);
  assert.equal(pa.status, "delivered");
  assert.equal(pa.payment.ref, `sol:${sig}`);
  sig = "different-synthetic-transaction";
  txAmount = 100n;
  const b = await orders.create({ offerId: "ES_5_30", methodId: "solana" });
  await orders.watch();
  assert.equal((await orders.get(b.order.id, b.token)).status, "underpaid");
});
