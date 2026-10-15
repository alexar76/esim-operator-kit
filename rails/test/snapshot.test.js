// The catalogue survives the supplier (src/snapshot.js): what a demo shows after its wholesale account
// stops answering, and what a seller may and may not serve from memory.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { snapshotCatalog } from "../src/snapshot.js";

const PLANS = [{ id: "FR_1_7", name: "France 1GB 7Days", countries: ["FR"], data_bytes: 1073741824, days: 7, cost_usd: 0.7 }];
const quiet = { warn() {} };

function supplier() {
  const s = { up: true, calls: [] };
  s.catalog = async () => { if (!s.up) throw Object.assign(new Error("account closed"), { code: "000101" }); return PLANS; };
  s.order = async (x) => { s.calls.push(["order", x]); return { orderRef: "B1" }; };
  s.profiles = async () => [];
  s.cancel = async () => true;
  s.balance = async () => ({ usd: 20 });
  return s;
}

test("a demo keeps its catalogue after the supplier stops answering, even across a restart and a month", async () => {
  const dir = await mkdtemp(join(tmpdir(), "esim-snapshot-"));
  const file = join(dir, "catalog-snapshot.json");
  let t = Date.parse("2026-10-14T12:00:00Z");
  const s = supplier();
  const a = snapshotCatalog(s, { file, fs, maxAgeMs: Infinity, now: () => t, log: quiet });
  assert.deepEqual(await a.catalog(), PLANS);
  assert.deepEqual(a.info(), { source: "live", at: "2026-10-14T12:00:00.000Z" });
  assert.equal((await stat(file)).mode & 0o777, 0o600, "the costs are the node's alone");

  s.up = false;
  t += 31 * 86_400_000;
  const restarted = snapshotCatalog(s, { file, fs, maxAgeMs: Infinity, now: () => t, log: quiet });
  assert.deepEqual(await restarted.catalog(), PLANS);
  assert.deepEqual(restarted.info(), { source: "snapshot", at: "2026-10-14T12:00:00.000Z" });

  s.up = true;
  assert.deepEqual(await restarted.catalog(), PLANS);
  assert.equal(restarted.info().source, "live");
  assert.equal(JSON.parse(await readFile(file, "utf8")).at, new Date(t).toISOString(), "a live catalogue renews the snapshot");
});

test("a seller serves the remembered catalogue for six hours, then says the supplier is down", async () => {
  const dir = await mkdtemp(join(tmpdir(), "esim-snapshot-"));
  const file = join(dir, "catalog-snapshot.json");
  let t = Date.parse("2026-10-14T12:00:00Z");
  const s = supplier();
  const seller = snapshotCatalog(s, { file, fs, now: () => t, log: quiet });
  await seller.catalog();
  s.up = false;
  t += 5 * 3_600_000;
  assert.deepEqual(await seller.catalog(), PLANS);
  t += 2 * 3_600_000;
  await assert.rejects(seller.catalog(), (e) => e.code === "000101", "the supplier's own error, not a stale catalogue");
});

test("no snapshot, or one that does not read: the supplier's error stands; orders always go to the supplier", async () => {
  const dir = await mkdtemp(join(tmpdir(), "esim-snapshot-"));
  const file = join(dir, "catalog-snapshot.json");
  const s = supplier();
  s.up = false;
  const n = snapshotCatalog(s, { file, fs, maxAgeMs: Infinity, log: quiet });
  await assert.rejects(n.catalog(), /account closed/);
  await writeFile(file, "{\"version\":1,\"at\":\"2026-10-14T12:00:00Z\",\"plans\":[]}");
  await assert.rejects(n.catalog(), /account closed/);
  await writeFile(file, "not json");
  await assert.rejects(n.catalog(), /account closed/);
  assert.deepEqual(await n.order({ transactionId: "t1", planId: "FR_1_7", costUsd: 0.7 }), { orderRef: "B1" });
  assert.deepEqual(s.calls, [["order", { transactionId: "t1", planId: "FR_1_7", costUsd: 0.7 }]]);
  assert.deepEqual(await n.balance(), { usd: 20 });
});
