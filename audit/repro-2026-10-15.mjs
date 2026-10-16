// Regression scenarios from the 2026-10-15 audit. All providers/payment networks are local fakes.
// Run: node esim-kit/audit/repro-2026-10-15.mjs
// Assertions require safe behavior; no real keys, funds or network calls.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { privateKeyToAccount } = createRequire(new URL('../rails/package.json', import.meta.url))('viem/accounts');
const wallet = privateKeyToAccount('0x' + '01'.repeat(32));
const thief = privateKeyToAccount('0x' + '02'.repeat(32));
import { createOrders } from '../store/src/orders.js';
import { evmTransfer, EVM_CHAINS } from '../store/src/payments/evm.js';
import { tronUsdt, USDT_TRON } from '../store/src/payments/tron.js';
import { usdcBase } from '../store/src/payments/usdc-base.js';
import { buildRefunder } from '../rails/src/refund.js';
import { fileStore } from '../rails/src/order.js';

const T = 1792050000000;
const PAY_TO = '0x' + '12'.repeat(20);
const PAYER = wallet.address;
const HASH = '0x' + 'cd'.repeat(32);
const SECRET = 'audit-only-status-secret-123456';
const OFFER = { offer_id: 'TR_AUDIT', name: 'Synthetic plan', price: { usd: '1.00', currency: 'USDC' }, _cost_usd: 0.5 };
const json = value => new Response(JSON.stringify(value));
const copy = value => value == null ? value : structuredClone(value);
function memory() {
  const rows = new Map();
  return { get: async id => copy(rows.get(id) ?? null), put: async (id, v) => { rows.set(id, copy(v)); }, all: async () => [...rows.values()].map(copy) };
}
function supplier() {
  const rows = new Map();
  const s = { cancellations: 0, orders: 0,
    catalog: async () => [], balance: async () => ({ usd: 100 }),
    order: async ({ transactionId }) => {
      if (!rows.has(transactionId)) {
        s.orders++;
        const n = rows.size + 1;
        rows.set(transactionId, { orderRef: `ORDER${n}`, profileId: `PROFILE${n}`, activationCode: `LPA:1$audit.invalid$synthetic-${n}`, state: 'NEW' });
      }
      return { orderRef: rows.get(transactionId).orderRef };
    },
    profiles: async ({ orderRef, profileId }) => [...rows.values()].filter(p => p.orderRef === orderRef || p.profileId === profileId).map(copy),
    cancel: async ({ profileId }) => { s.cancellations++; for (const p of rows.values()) if (p.profileId === profileId) p.state = 'CANCEL'; return true; }
  };
  return s;
}
function shop(methods, now = () => T) {
  const sup = supplier(), db = memory();
  const orders = createOrders({ db, supplier: sup, railsStore: memory(), statusSecret: SECRET,
    methods, offersById: id => id === OFFER.offer_id ? OFFER : null, now, log: {} });
  return { orders, sup, db };
}
const create = (orders, methodId, asset) => orders.create({ offerId: OFFER.offer_id, methodId, asset });
const pad = address => '0x' + address.slice(2).toLowerCase().padStart(64, '0');

// 1. The attacker supplies only its OWN order token and a victim's PUBLIC transaction hash.
{
  const method = evmTransfer({ payTo: PAY_TO, chains: [8453], fetchImpl: async (_url, init) => {
    const { method: rpcMethod } = JSON.parse(init.body);
    const results = {
      eth_getTransactionReceipt: { status: '0x1', blockNumber: '0x64', logs: [{ address: EVM_CHAINS[8453].tokens.USDC[0],
        topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', pad(PAYER), pad(PAY_TO)], data: '0xf4240' }] },
      eth_getBlockByNumber: { timestamp: '0x' + Math.floor(T / 1000).toString(16) }, eth_blockNumber: '0x65'
    };
    return json({ result: results[rpcMethod] });
  }});
  const { orders } = shop([method]);
  const victim = await create(orders, 'evm', { chainId: 8453, token: 'USDC' });
  const attacker = await create(orders, 'evm', { chainId: 8453, token: 'USDC' });
  const stolen = await orders.claim(attacker.order.id, attacker.token, HASH);
  assert.equal(stolen.error, 'payer_signature_required');
  const forged = await orders.claim(attacker.order.id, attacker.token, HASH, {
    signature: await thief.signMessage({ message: attacker.order.intent.claim_message + HASH })
  });
  assert.ok(forged.error);
  const rightful = await orders.claim(victim.order.id, victim.token, HASH, {
    signature: await wallet.signMessage({ message: victim.order.intent.claim_message + HASH })
  });
  const read = await orders.get(attacker.order.id, attacker.token);
  assert.equal(rightful.order.status, 'delivered'); assert.equal(read.esim, undefined);
  console.log('PASS EVM: public hash and attacker signature refused; rightful payer receives eSIM');
}

// 2. Reusing a completed Tron's exact amount also reuses its transfer and reveals its profile.
{
  const method = tronUsdt({ address: USDT_TRON, uniq: () => 42, fetchImpl: async () => json({ data: [{
    to: USDT_TRON, from: 'synthetic-victim', token_info: { address: USDT_TRON }, type: 'Transfer', value: '1000042', transaction_id: 'synthetic-tron-tx'
  }] }) });
  const { orders, sup } = shop([method]);
  const first = await create(orders, 'tron'); await orders.watch();
  const second = await create(orders, 'tron'); await orders.watch();
  const a = await orders.get(first.order.id, first.token);
  assert.equal(a.status, 'delivered'); assert.equal(second.error, 'temporarily_unavailable');
  assert.equal(sup.orders, 1);
  console.log('PASS TRON: completed order amount cannot be reused within the payment window');
}

// 3. Duplicate authorize requests race; the losing settlement cancels the winning paid profile.
{
  let settled = 0;
  const method = { id: 'fake-authorize', kind: 'authorize', enabled: () => true, intent: () => ({}),
    verify: async () => ({ ok: true, ref: 'same-payment', payer: PAYER }),
    settle: async () => { settled++; await new Promise(resolve => setTimeout(resolve, 5)); return { ok: true, tx: HASH }; }
  };
  const { orders, sup } = shop([method]); const o = await create(orders, method.id);
  const result = await Promise.all([orders.authorize(o.order.id, o.token, {}), orders.authorize(o.order.id, o.token, {})]);
  assert.ok(result.some(r => !r.error)); assert.equal(settled, 1); assert.equal(sup.cancellations, 0);
  console.log('PASS CONCURRENCY: duplicate authorize settles once and never cancels the paid profile');
}

// 4. A network timeout after settlement is treated as definitely unpaid; no reconciliation.
{
  let transferred = false;
  const method = usdcBase({ payTo: PAY_TO, now: () => T, facilitator: {
    verify: async () => ({ isValid: true }), settle: async () => { transferred = true; throw new Error('response lost after chain transfer'); }
  }});
  const { orders, sup } = shop([method]); const o = await create(orders, method.id);
  const result = await orders.authorize(o.order.id, o.token, { signature: '0x' + '11'.repeat(65),
    authorization: { ...o.order.intent.typed_data.message, from: PAYER } });
  assert.ok(transferred); assert.equal(result.error, 'settlement_pending'); assert.equal(sup.cancellations, 0);
  assert.equal((await orders.get(o.order.id, o.token)).esim, undefined);
  assert.equal((await orders.authorize(o.order.id, o.token, {})).error, 'not_awaiting_payment');
  console.log('PASS AMBIGUOUS SETTLEMENT: profile retained, outcome recorded, repeat payment blocked');
}

// 5. Daily refund budget is checked before awaits and reserved afterwards.
{
  const signer = { address: PAY_TO, signTypedData: async () => '0x' + '11'.repeat(65) };
  let amountPaid = 0;
  const facilitator = { verify: async () => ({ isValid: true }), settle: async (_p, t) => {
    amountPaid += Number(t.amount) / 1e6; return { success: true, transaction: HASH }; } };
  const settings = { signer, facilitator, budgetStore: memory(), maxUsd: 1, dailyMaxUsd: 1, now: () => T, log: {} };
  const refunder = await buildRefunder(settings);
  const attempted = await Promise.allSettled([refunder.pay({ to: PAYER, usd: '0.75', reference: 'one' }), refunder.pay({ to: PAYER, usd: '0.75', reference: 'two' })]);
  assert.equal(amountPaid, 0.75); assert.equal(attempted.filter(r => r.status === 'rejected').length, 1);
  const restarted = await buildRefunder(settings);
  await assert.rejects(restarted.pay({ to: PAYER, usd: '0.75', reference: 'three' }), /REFUND_DAILY_MAX_USD/); assert.equal(amountPaid, 0.75);
  console.log('PASS REFUND CAP: concurrent refunds and a recreated refunder respect persisted budget');
}

// 6. One transient disk error permanently rejects the write queue; corrupt DB is read as empty.
{
  let writes = 0;
  const store = fileStore('not-a-real-file', { readFile: async () => '{}', writeFile: async () => {
    writes++; if (writes === 1) throw new Error('synthetic ENOSPC'); }, rename: async () => {} });
  await assert.rejects(store.put('one', {})); await store.put('two', {}); assert.equal(writes, 2);
  const corrupt = fileStore('not-a-real-file', { readFile: async () => '{broken-json' });
  await assert.rejects(corrupt.get('already-paid-order'), SyntaxError);
  console.log('PASS PERSISTENCE: write queue recovers; corrupt records fail closed');
}
