#!/usr/bin/env node
// Write node.toml for `aimarket node` from your live catalogue (whichever supplier is configured:
// SUPPLIER=esimaccess with its two key files, or SUPPLIER=http with SUPPLIER_URL and its secret):
//   node scripts/node-toml.mjs --name "Your eSIM shop" --url https://esim.example.com --product esim-yourshop > node.toml
// --demo marks a node that sells nothing (DEMO_MODE=1) as a showcase in every description.
import { supplierFromEnv } from "../src/config.js";
import { offersFromPlans } from "../src/offers.js";
import { nodeToml } from "../src/nodetoml.js";
import { ed25519Signer } from "../src/node.js";
import { snapshotCatalog } from "../src/snapshot.js";
import { existsSync, readFileSync } from "node:fs";
import * as fsp from "node:fs/promises";

const arg = (k, d = "") => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
// The same catalogue the running node serves: live, or its last snapshot while the supplier is silent.
const supplier = snapshotCatalog(supplierFromEnv(), { file: process.env.CATALOG_SNAPSHOT || "/data/catalog-snapshot.json",
                                                      fs: fsp, maxAgeMs: Infinity });
const offers = offersFromPlans(await supplier.catalog());
const keyFile = process.env.PROVIDER_KEY_FILE || "/data/provider_ed25519.pem";
process.stdout.write(nodeToml({ name: arg("name", "eSIM shop"), url: arg("url"), product: arg("product"),
                                upstream: arg("upstream", "http://127.0.0.1:9490"),
                                countries: offers.flatMap((o) => o.coverage.countries), demo: process.argv.includes("--demo"),
                                // The node's own provider key, when this runs where the node keeps it.
                                providerPubkey: arg("provider-pubkey") || (existsSync(keyFile) ? ed25519Signer(readFileSync(keyFile, "utf8")).pubkey : "") }));
