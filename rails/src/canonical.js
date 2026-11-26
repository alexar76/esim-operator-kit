import { createHash } from "node:crypto";

/** JSON as Python's json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False) writes it. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The bytes a hub checks a provider's answer against (aimarket_hub.supply_security._bound_response_canonical). */
export function boundCanonical(capabilityId, productId, input, result) {
  const inputSha = createHash("sha256").update(canonicalJson(input || {}), "utf8").digest("hex");
  return canonicalJson({ capability_id: capabilityId || "", product_id: productId || "", input_sha256: inputSha, result });
}
