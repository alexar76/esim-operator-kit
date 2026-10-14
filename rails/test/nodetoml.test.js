import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeToml } from "../src/nodetoml.js";

test("node.toml names the catalogue's countries, popular first, so the admission sandbox quotes a real one", () => {
  const t = nodeToml({ name: "Shop \"A\"", url: "https://esim.example.com/", product: "esim-shop", countries: ["SI", "JP", "XX1", "FR", "SI"] });
  assert.match(t, /^url = "https:\/\/esim\.example\.com"$/m);
  assert.match(t, /^name = "Shop \\"A\\""$/m);
  assert.match(t, /enum = \["FR", "JP", "SI"\]/);
  assert.equal((t.match(/\[\[capability\]\]/g) || []).length, 2);
  assert.ok(!t.includes("esim.order"), "the order has a price per plan: it is not a node.toml capability");
  assert.throws(() => nodeToml({ name: "x", url: "http://127.0.0.1:9", product: "esim-shop", countries: ["FR"] }), /public https/);
  assert.throws(() => nodeToml({ name: "x", url: "https://a.example", product: "Bad Slug!", countries: ["FR"] }), /slug/);
  assert.throws(() => nodeToml({ name: "x", url: "https://a.example", product: "esim-shop", countries: [] }), /no country/);
});
