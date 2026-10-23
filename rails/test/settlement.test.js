import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNode, ed25519Signer } from '../src/node.js';
import { fileStore } from '../src/order.js';
import { buildRefunder } from '../src/refund.js';

test('refund budget survives a real file reopen and uncertain transfers stay reserved', async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'esim-budget-restart-'));
  try {
    const settings = { signer: { address: '0x' + '12'.repeat(20), signTypedData: async () => '0x' + '11'.repeat(65) },
      maxUsd: 1, dailyMaxUsd: 1, now: () => 1792050000000, log: {},
      facilitator: { verify: async () => ({ isValid: true }), settle: async () => { throw Error('lost response'); } } };
    const pay = { to: '0x' + 'ab'.repeat(20), usd: '0.75', reference: 'PROFILE1' };
    const path = join(dir, 'budget.json');
    await assert.rejects((await buildRefunder({ ...settings, budgetStore: fileStore(path, fs) })).pay(pay), /lost response/);
    const restarted = await buildRefunder({ ...settings, budgetStore: fileStore(path, fs) });
    await assert.rejects(restarted.pay(pay), /already reserved/);
    await assert.rejects(restarted.pay({ ...pay, reference: 'PROFILE2' }), /REFUND_DAILY_MAX_USD/);
    await assert.rejects(buildRefunder({ ...settings, budgetStore: fileStore(path, fs), dailyMaxUsd: NaN }), /finite/);
    await assert.rejects(buildRefunder(settings), /durable budgetStore/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

async function serve(failSettlement = false, recovery = false, slow = false) {
  const dir = await fs.mkdtemp(join(tmpdir(), 'esim-settlement-'));
  const events = []; let orders = 0, cancels = 0, attempts = 0, node, cancelFails = false;
  let allocationReady = !slow;
  const purchased = new Map();
  const supplier = {
    catalog: async () => [{ id: 'TEST', name: 'Test', cost_usd: 0.1, countries: ['TR'], data_bytes: 1073741824, days: 7 }],
    balance: async () => ({ usd: 100 }),
    order: async ({ transactionId }) => {
      if (!purchased.has(transactionId)) { orders++; purchased.set(transactionId, { orderRef: 'ORDER123' }); }
      return purchased.get(transactionId);
    },
    profiles: async () => allocationReady ? [{ profileId: 'PROFILE123', orderRef: 'ORDER123', activationCode: 'LPA:1$fake$secret', state: 'NEW' }] : [],
    cancel: async () => { cancels++; if (cancelFails) { cancelFails = false; throw Error("supplier unavailable"); } }
  };
  const paywall = { tracksSettlement: true, payTo: '0x' + '12'.repeat(20), middleware(req, res, next) {
    if (req.path !== '/order') return next();
    attempts++;
    const json = res.json.bind(res);
    res.json = async body => {
      if (res.statusCode >= 400) return json(body);
      assert.equal(events.filter(e => e === 'agent_order.delivered').length, 0, 'no delivered event before settlement');
      const payload = JSON.parse(Buffer.from(req.get('payment-signature'), 'base64').toString());
      if (failSettlement) { await node.settleFailed(payload); return json({ error: 'settlement_pending' }); }
      await node.settled(payload, { success: true, transaction: '0xfake', network: 'eip155:8453' });
      return json(body);
    };
    next();
  } };
  let outcome = { status: "pending" };
  const reconciler = recovery ? { prepare: async auth => ({ ...auth, fromBlock: "0x1" }), resolve: async () => outcome } : null;
  const makeNode = (overrides = {}) => createNode({ reconciler, supplier, store: fileStore(join(dir, 'orders.json'), fs), secret: 'test-secret-at-least-16-chars', orderWaitMs: 0,
    signer: ed25519Signer(), publicUrl: 'https://audit.invalid', paywall, log: {}, events: { emit: type => events.push(type) }, ...overrides });
  node = makeNode();
  const listen = () => new Promise(resolve => { const s = node.app.listen(0, "127.0.0.1", () => resolve(s)); });
  let server = await listen();
  const header = Buffer.from(JSON.stringify({ payload: { authorization: { from: '0x' + 'ab'.repeat(20), nonce: '0x' + '11'.repeat(32) }, signature: 'synthetic' } })).toString('base64');
  return { events,
    finishAllocation: () => { allocationReady = true; },
    failCancelOnce: () => { cancelFails = true; },
    confirm: () => node.settled(JSON.parse(Buffer.from(header, "base64").toString()), { success: true, transaction: "0xconfirmed" }),
    reconcile: async result => { outcome = result; await node.reconcile(); },
    restart: async (overrides) => { await new Promise(resolve => server.close(resolve)); node = makeNode(overrides); server = await listen(); },
    counts: () => ({ orders, cancels, attempts }), header,
    call: async (h = header, recovery = "private-recovery-token-12345678901234567890") => {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/order`, { method: 'POST', headers: { 'content-type': 'application/json', 'payment-signature': h, 'x-esim-recovery': recovery }, body: JSON.stringify({ offer_id: 'TEST' }) });
      return { status: r.status, body: await r.json(), receipt: r.headers.get('payment-response') };
    },
    close: async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(dir, { recursive: true, force: true }); }
  };
}

test('abandoned agent allocation is recovered and cancelled from finalized nonpayment', async () => {
  const t = await serve(false, true, true);
  try {
    assert.equal((await t.call()).body.error, 'allocation_pending');
    assert.equal(t.counts().orders, 1);
    await t.restart();
    await t.reconcile({ status: 'pending' });
    assert.equal(t.counts().cancels, 0);
    await t.reconcile({ status: 'unpaid', reason: 'expired_unused' });
    assert.equal(t.counts().cancels, 0, 'no profile exists to cancel yet');
    t.finishAllocation();
    await t.reconcile({ status: 'unpaid', reason: 'expired_unused' });
    await t.reconcile({ status: 'unpaid', reason: 'expired_unused' });
    assert.equal(t.counts().orders, 1);
    assert.equal(t.counts().cancels, 1);
    assert.deepEqual(t.events, ['agent_order.cancelled']);
  } finally { await t.close(); }
});

test('late paid agent allocation is delivered after restart without a second settlement', async () => {
  const t = await serve(false, true, true);
  try {
    assert.equal((await t.call()).body.error, 'allocation_pending');
    await t.restart();
    t.finishAllocation();
    await t.reconcile({ status: 'paid', transaction: '0xconfirmed' });
    const result = await t.call();
    assert.equal(result.status, 200);
    assert.equal(result.body.result.activation_code, 'LPA:1$fake$secret');
    assert.deepEqual(t.counts(), { orders: 1, cancels: 0, attempts: 1 });
    assert.deepEqual(t.events, ['agent_order.delivered']);
  } finally { await t.close(); }
});

test('agent retries reuse confirmed delivery, bind the original signed payload, and emit delivery once', async () => {
  const t = await serve();
  try {
    const result = await Promise.all([t.call(), t.call()]);
    assert.deepEqual(result.map(r => r.status), [200, 200]);
    assert.equal(result[0].body.result.activation_code, result[1].body.result.activation_code);
    assert.ok(result[1].receipt);
    assert.deepEqual(t.counts(), { orders: 1, cancels: 0, attempts: 1 });
    assert.deepEqual(t.events, ['agent_order.delivered']);
    assert.equal((await t.call(t.header, '')).body.error, 'recovery_required', 'public on-chain payment alone cannot recover a private eSIM');
    const forged = JSON.parse(Buffer.from(t.header, 'base64').toString()); forged.payload.signature = 'changed';
    assert.equal((await t.call(Buffer.from(JSON.stringify(forged)).toString('base64'))).status, 409);
  } finally { await t.close(); }
});

test('agent settlement uncertainty retains the profile, withholds delivery and blocks repeat settlement', async () => {
  const t = await serve(true);
  try {
    assert.equal((await t.call()).body.result, undefined);
    const retry = await t.call();
    assert.equal(retry.status, 409); assert.equal(retry.body.error, 'settlement_pending');
    assert.deepEqual(t.counts(), { orders: 1, cancels: 0, attempts: 1 });
    assert.deepEqual(t.events, ['agent_order.settlement_pending']);
  } finally { await t.close(); }
});


test('agent payment recovers after a process restart, without another settlement or public delivery access', async () => {
  const t = await serve(true, true);
  try {
    await t.call(); await t.restart();
    await t.reconcile({ status: 'pending', reason: 'rpc_unavailable' });
    assert.equal((await t.call()).body.error, 'settlement_pending');
    await t.reconcile({ status: 'paid', transaction: '0xconfirmed' });
    assert.equal((await t.call(t.header, '')).body.error, 'recovery_required');
    assert.ok((await t.call()).body.result.activation_code);
    await t.reconcile({ status: 'paid', transaction: '0xconfirmed' });
    assert.deepEqual(t.counts(), { orders: 1, cancels: 0, attempts: 1 });
    assert.deepEqual(t.events, ['agent_order.settlement_pending', 'agent_order.delivered']);
  } finally { await t.close(); }
});

test('agent finalized nonpayment cancels once and never recharges the old authorization', async () => {
  const t = await serve(true, true);
  try {
    await t.call(); await t.restart();
    await t.reconcile({ status: 'unpaid', reason: 'expired_unused' });
    await t.reconcile({ status: 'unpaid', reason: 'expired_unused' });
    assert.equal((await t.call()).body.error, 'order_closed');
    assert.deepEqual(t.counts(), { orders: 1, cancels: 1, attempts: 1 });
  } finally { await t.close(); }
});


test('failed cancellation resumes after restart without treating the order as paid', async () => {
  const t = await serve(true, true);
  try {
    await t.call(); t.failCancelOnce();
    await t.reconcile({ status: 'unpaid', reason: 'expired_unused' });
    assert.equal((await t.call()).body.error, 'payment_not_received');
    await t.restart(); await t.reconcile({ status: 'pending' });
    assert.equal((await t.call()).body.error, 'order_closed');
    assert.deepEqual(t.counts(), { orders: 1, cancels: 2, attempts: 1 });
  } finally { await t.close(); }
});

test('late successful facilitator callback cannot be overwritten by an older pending chain read', async () => {
  const t = await serve(true, true);
  try {
    await t.call();
    let finish; const delayed = new Promise(resolve => { finish = resolve; });
    const pass = t.reconcile(delayed);
    await new Promise(resolve => setTimeout(resolve, 25));
    await t.confirm(); finish({ status: 'pending' }); await pass;
    assert.ok((await t.call()).body.result.activation_code);
    assert.deepEqual(t.events, ['agent_order.settlement_pending', 'agent_order.delivered']);
  } finally { await t.close(); }
});


test('reconciled delivery remains recoverable when sales are disabled and the catalogue is gone', async () => {
  const t = await serve(true, true);
  try {
    await t.call(); await t.reconcile({ status: 'paid', transaction: '0xconfirmed' });
    await t.restart({ demo: true, paywall: null, pricing: { marginPct: 999 } });
    assert.ok((await t.call()).body.result.activation_code);
    assert.deepEqual(t.events, ['agent_order.settlement_pending', 'agent_order.delivered']);
    assert.deepEqual(t.counts(), { orders: 1, cancels: 0, attempts: 1 });
  } finally { await t.close(); }
});
