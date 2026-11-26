#!/usr/bin/env node
import { parseArgs } from "node:util";
import { checkSeller, report } from "../src/check.js";

const usage = "Usage: esim-rails-check <seller base URL> [--country FR]";

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      country: { type: "string", default: "FR" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(usage);
    return 0;
  }
  if (positionals.length !== 1) throw new Error(usage);
  const base = new URL(positionals[0]);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new Error("Use an HTTP(S) seller base URL without credentials, query or fragment.");
  }
  const country = values.country.toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new Error("Use a two-letter country code.");
  const results = await checkSeller(base, {
    country,
    fetchImpl: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }),
  });
  return report(results) === 0 ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
