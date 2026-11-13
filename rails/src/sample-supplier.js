// A supplier with a small made-up catalogue, for trying the kit on a laptop before any wholesale
// account exists (./onboard.sh --try). Every plan id starts with SAMPLE-, every name says "Sample",
// and the costs are round invented numbers, not anyone's wholesale prices. It sells nothing: order()
// is a plain "no", so a buyer is never charged for it, and there are no profiles to read or cancel.
//
//   SUPPLIER=sample      no keys, no network
import { SupplierError } from "./esimaccess.js";

const GB = 1024 ** 3;

// [country, its name, [GB, days, cost in USD], …]
const COUNTRIES = [
  ["FR", "France", [1, 7, 1.2], [3, 15, 2.6], [10, 30, 6.5]],
  ["ES", "Spain", [1, 7, 1.2], [3, 15, 2.6], [10, 30, 6.5]],
  ["IT", "Italy", [1, 7, 1.2], [3, 15, 2.6], [10, 30, 6.5]],
  ["DE", "Germany", [1, 7, 1.3], [3, 15, 2.8], [10, 30, 7.0]],
  ["GB", "United Kingdom", [1, 7, 1.3], [3, 15, 2.8], [10, 30, 7.0]],
  ["US", "United States", [1, 7, 1.6], [3, 15, 3.4], [10, 30, 9.0]],
  ["TR", "Türkiye", [1, 7, 1.5], [3, 15, 3.2], [10, 30, 8.0]],
  ["TH", "Thailand", [1, 7, 0.9], [3, 15, 1.9], [10, 30, 4.8]],
  ["JP", "Japan", [1, 7, 1.4], [3, 15, 3.0], [10, 30, 7.5]],
  ["AE", "United Arab Emirates", [1, 7, 2.0], [3, 15, 4.5], [10, 30, 12.0]],
  ["PT", "Portugal", [1, 7, 1.2], [3, 15, 2.6], [10, 30, 6.5]],
  ["GR", "Greece", [1, 7, 1.2], [3, 15, 2.6], [10, 30, 6.5]],
  ["ID", "Indonesia", [1, 7, 0.9], [3, 15, 1.9], [10, 30, 4.8]],
  ["VN", "Viet Nam", [1, 7, 0.9], [3, 15, 1.9], [10, 30, 4.8]],
  ["GE", "Georgia", [1, 7, 1.5], [3, 15, 3.2], [10, 30, 8.0]],
  ["MX", "Mexico", [1, 7, 1.6], [3, 15, 3.4], [10, 30, 9.0]],
];

const EUROPE = ["FR", "ES", "IT", "DE", "PT", "GR", "NL", "BE", "AT", "IE", "PL", "CZ", "HR", "SE", "DK", "FI"];

function plan(id, name, countries, kind, gb, days, cost) {
  return {
    id, name, countries, kind, data_bytes: gb * GB, days, speed: "4G/5G",
    networks: [], top_up: false, unused_valid_days: 180, cost_usd: cost,
  };
}

/** The made-up catalogue, the same every time. */
export function samplePlans() {
  const plans = [];
  for (const [cc, name, ...sizes] of COUNTRIES) {
    for (const [gb, days, cost] of sizes) plans.push(plan(`SAMPLE-${cc}-${gb}-${days}`, `Sample · ${name} ${gb} GB / ${days} days`, [cc], "country", gb, days, cost));
  }
  plans.push(plan("SAMPLE-EU16-5-30", "Sample · Europe (16 countries) 5 GB / 30 days", EUROPE, "region", 5, 30, 4.5));
  return plans;
}

export function sampleSupplier() {
  const no = () => { throw new SupplierError("sample_only", "the sample catalogue sells nothing: connect a wholesale account (SUPPLIER in .env)"); };
  return {
    kind: "sample",
    async catalog() { return samplePlans(); },
    async order() { return no(); },
    async profiles() { return []; },
    async cancel() { return no(); },
    async balance() { return null; },
  };
}
