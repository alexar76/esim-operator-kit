import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeToml } from "../src/nodetoml.js";

test("node.toml names the catalogue's countries, popular first, so the admission sandbox quotes a real one", () => {
  const t = nodeToml({ name: "Shop \"A\"", url: "https://esim.example.com/", product: "esim-shop", countries: ["SI", "JP", "XX1", "FR", "SI"] });
  assert.match(t, /^url = "https:\/\/esim\.example\.com"$/m);
  assert.match(t, /^name = "Shop \\"A\\""$/m);
  assert.match(t, /enum = \["FR", "JP", "SI"\]/);
  assert.equal((t.match(/\[\[capability\]\]/g) || []).length, 1);
  assert.ok(!t.includes("esim.order"), "the order has a price per plan: it is not a node.toml capability");
  assert.throws(() => nodeToml({ name: "x", url: "http://127.0.0.1:9", product: "esim-shop", countries: ["FR"] }), /public https/);
  assert.throws(() => nodeToml({ name: "x", url: "https://a.example", product: "Bad Slug!", countries: ["FR"] }), /slug/);
  assert.throws(() => nodeToml({ name: "x", url: "https://a.example", product: "esim-shop", countries: [] }), /no country/);
});

test("a demo node says so in every description, and a selling node does not", () => {
  const demo = nodeToml({ name: "Demo", url: "https://esim.example.com", product: "esim-demo", countries: ["FR"], demo: true });
  assert.equal((demo.match(/DEMO SELLER: live prices, orders are refused with demo_mode/g) || []).length, 1);
  assert.match(demo, /^description = "Demo seller of the eSIM operator kit: live travel eSIM offers for 1 countries/m);
  assert.match(demo, /^name = "Travel eSIM offers"$/m);
  const real = nodeToml({ name: "Shop", url: "https://esim.example.com", product: "esim-shop", countries: ["FR"] });
  assert.ok(!real.includes("DEMO SELLER"));
});

test("node.toml carries the node's provider key, so hubs tie buyers' delivery receipts to the listing", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  const toml = nodeToml({ name: "x", url: "https://esim.example.com", product: "esim-x", countries: ["FR"], providerPubkey: key });
  assert.equal((toml.match(new RegExp(`provider_pubkey = "${key.replace(/[+/=]/g, (c) => "\\" + c)}"`, "g")) || []).length, 1);
  assert.ok(!nodeToml({ name: "x", url: "https://esim.example.com", product: "esim-x", countries: ["FR"] }).includes("provider_pubkey"));
  assert.throws(() => nodeToml({ name: "x", url: "https://esim.example.com", product: "esim-x", countries: ["FR"], providerPubkey: "nope" }), /providerPubkey/);
});

