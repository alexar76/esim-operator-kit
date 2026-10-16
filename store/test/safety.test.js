import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { jsonDb } from '../src/orders.js';
import { usdcBase } from '../src/payments/usdc-base.js';

test('payment safety: six independently reproduced audit scenarios', async () => {
  await import('../../audit/repro-2026-10-15.mjs');
});

test('store JSON fails closed on corruption and recovers after a failed write', async () => {
  let writes = 0;
  const db = jsonDb('fake', { readFile: async () => '{}', writeFile: async () => {
    if (++writes === 1) throw Error('disk full');
  }, rename: async () => {} });
  await assert.rejects(db.put('a', {}));
  await db.put('b', {});
  assert.equal(writes, 2);
  await assert.rejects(jsonDb('fake', { readFile: async () => '{bad' }).all(), SyntaxError);
  await assert.rejects(jsonDb('fake', { readFile: async () => { throw Object.assign(Error('denied'), { code: 'EACCES' }); } }).all());
});

test('signed Base payment must carry this order’s nonce and validity period', async () => {
  let verified = 0;
  const m = usdcBase({ payTo: '0x' + '12'.repeat(20), facilitator: { verify: async () => { verified++; return { isValid: true }; } } });
  const order = { price_cents: 100 };
  order.intent = m.intent(order);
  const submission = { authorization: { ...order.intent.typed_data.message, from: '0x' + 'ab'.repeat(20) }, signature: '0x' + '11'.repeat(65) };
  assert.equal((await m.verify(order, { ...submission, authorization: { ...submission.authorization, nonce: '0x' + '22'.repeat(32) } })).reason, 'wrong_terms');
  assert.equal((await m.verify(order, { ...submission, authorization: { ...submission.authorization, validBefore: '9999999999' } })).reason, 'wrong_terms');
  assert.equal(verified, 0);
  assert.equal((await m.verify(order, submission)).ok, true);
});

test('onboard --check leaves files untouched, rejects missing secrets and checks running seller', async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'esim-onboard-test-'));
  try {
    await fs.copyFile(new URL('../../onboard.sh', import.meta.url), join(dir, 'onboard.sh'));
    const bin = join(dir, 'bin'); await fs.mkdir(bin);
    for (const [name, script] of Object.entries({
      docker: 'echo mock-compose', ss: 'exit 0', getent: 'echo "127.0.0.1 STREAM seller.example"',
      curl: 'echo \'{"ok":true,"paid_orders":false}\''
    })) await fs.writeFile(join(bin, name), '#!/bin/sh\n' + script + '\n', { mode: 0o755 });
    const base = 'DOMAIN=seller.example\nSTORE_NAME=Test\nPRODUCT_ID=esim-test\nSUPPLIER=airalo\n';
    const run = () => spawnSync('bash', ['onboard.sh', '--check'], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: bin + ':' + process.env.PATH } });
    await fs.writeFile(join(dir, '.env'), base);
    assert.equal(run().status, 1);
    assert.equal(await fs.readFile(join(dir, '.env'), 'utf8'), base);
    await assert.rejects(fs.access(join(dir, 'secrets')));
    const settings = base + 'DEMO_MODE=1\n';
    await fs.writeFile(join(dir, '.env'), settings);
    const missing = run();
    assert.equal(missing.status, 1, missing.stdout + missing.stderr);
    assert.match(missing.stderr, /required secret/);
    await assert.rejects(fs.access(join(dir, 'secrets')));
    await fs.mkdir(join(dir, 'secrets'));
    await fs.writeFile(join(dir, 'secrets', 'airalo_client_id'), 'fake');
    await fs.writeFile(join(dir, 'secrets', 'airalo_client_secret'), 'fake');
    const ready = run();
    assert.equal(ready.status, 0, ready.stdout + ready.stderr);
    assert.equal(await fs.readFile(join(dir, '.env'), 'utf8'), settings, 'PROXY is not added by --check');
    await fs.writeFile(join(bin, 'curl'), '#!/bin/sh\nexit 7\n', { mode: 0o755 });
    assert.equal(run().status, 1, 'unreachable seller is not reported as ready');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('external agent keeps the complete delivery in a private file and never overwrites it', async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'esim-agent-test-'));
  try {
    const preload = join(dir, 'fake-fetch.mjs'), output = join(dir, 'delivery.json');
    await fs.writeFile(preload, `globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.endsWith('/quote')) return Response.json({success:true,result:{seller:{name:'Fake'},offers:[{offer_id:'TEST',name:'Test',price:{usd:'0.50'}}],order:{url:'https://audit.invalid/order'}}});
      if (url.endsWith('/order')) return Response.json({success:true,result:{esim_tran_no:'PROFILE123',activation_code:'LPA:1$fake$complete-secret',status_token:'private-status-token'}});
      throw Error('unexpected URL');
    };`);
    const script = new URL('../../rails/examples/agent-buy.mjs', import.meta.url).pathname;
    const args = ['--import', preload, script, 'https://audit.invalid', 'TR', '--yes', '--output', output];
    const env = { ...process.env, AGENT_PRIVATE_KEY: '0x' + '01'.repeat(32) };
    const run = spawnSync(process.execPath, args, { encoding: 'utf8', env });
    assert.equal(run.status, 0, run.stderr);
    const saved = JSON.parse(await fs.readFile(output, 'utf8'));
    assert.equal(saved.delivery.activation_code, 'LPA:1$fake$complete-secret');
    assert.equal(saved.delivery.status_token, 'private-status-token');
    assert.equal((await fs.stat(output)).mode & 0o777, 0o600);
    assert.ok(!run.stdout.includes('complete-secret') && !run.stdout.includes('private-status-token'));
    assert.notEqual(spawnSync(process.execPath, args, { encoding: 'utf8', env }).status, 0);
    assert.deepEqual(JSON.parse(await fs.readFile(output, 'utf8')), saved);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
