#!/usr/bin/env node
// Write node.toml for `aimarket node` from your live catalogue:
//   ESIMACCESS_ACCESS_CODE_FILE=… ESIMACCESS_SECRET_KEY_FILE=… \
//   node scripts/node-toml.mjs --name "Your eSIM shop" --url https://esim.example.com --product esim-yourshop > node.toml
import { createClient, keysFromFiles } from "../src/esimaccess.js";
import { offersFromEsimAccess } from "../src/offers.js";
import { nodeToml } from "../src/nodetoml.js";

const arg = (k, d = "") => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const client = createClient(keysFromFiles({ accessCodeFile: process.env.ESIMACCESS_ACCESS_CODE_FILE,
                                            secretKeyFile: process.env.ESIMACCESS_SECRET_KEY_FILE }));
const offers = offersFromEsimAccess(await client.packages());
process.stdout.write(nodeToml({ name: arg("name", "eSIM shop"), url: arg("url"), product: arg("product"),
                                upstream: arg("upstream", "http://127.0.0.1:9490"),
                                countries: offers.flatMap((o) => o.coverage.countries) }));
