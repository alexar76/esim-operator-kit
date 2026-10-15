// Local preview of the seller node without wholesale keys: node scripts/dev-node.mjs [port]
// The documented eSIM Access fixtures stand in for the catalogue; orders are off (no wallet).
import * as fsp from "node:fs/promises";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNode, ed25519Signer } from "../src/node.js";
import { fileStore } from "../src/order.js";

const port = Number(process.argv[2] || 9490);
const fx = (n) => JSON.parse(readFileSync(new URL(`../test/fixtures/${n}`, import.meta.url), "utf8"));
const supplier = { packages: async () => fx("package-list.json").obj.packageList, profiles: async () => [], balance: async () => ({ units: 0 }) };
const dir = await mkdtemp(join(tmpdir(), "esim-node-dev-"));
const node = createNode({ supplier, store: fileStore(join(dir, "orders.json"), fsp), secret: "dev-status-secret-0123456789",
                          signer: ed25519Signer(), publicUrl: process.env.PUBLIC_URL || `http://127.0.0.1:${port}`, demo: process.env.DEMO === "1" });
node.app.listen(port, "127.0.0.1", (err) => {
  if (err) { console.error(`Preview could not listen on port ${port}: ${err.code}`); process.exitCode = 1; return; }
  console.log(`esim-rails preview on http://127.0.0.1:${port}/healthz`);
});
