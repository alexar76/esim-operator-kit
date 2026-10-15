// A small JSON Schema checker for the contract in spec/esim-v1 — the keywords those files use and no
// more (type, required, properties, items, enum, const, minimum, maximum, minLength, maxLength,
// pattern, minItems, $ref). The same files are what an operator in another language validates against.
import { readFileSync, readdirSync } from "node:fs";

const DIR = new URL("../spec/esim-v1/", import.meta.url);
const schemas = new Map(readdirSync(DIR).filter((f) => f.endsWith(".schema.json"))
  .map((f) => [f, JSON.parse(readFileSync(new URL(f, DIR), "utf8"))]));

const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
const fits = (v, t) => typeOf(v) === t || (t === "number" && typeof v === "number" && Number.isFinite(v));

function check(s, v, path, out) {
  if (s.$ref) return check(schemas.get(s.$ref), v, path, out);
  if (s.type) {
    const types = [].concat(s.type);
    if (!types.some((t) => fits(v, t))) { out.push(`${path}: expected ${types.join(" or ")}, got ${typeOf(v)}`); return out; }
  }
  if ("const" in s && v !== s.const) out.push(`${path}: must be ${JSON.stringify(s.const)}`);
  if (s.enum && !s.enum.includes(v)) out.push(`${path}: must be one of ${s.enum.join(", ")}`);
  if (typeof v === "number") {
    if (s.minimum !== undefined && v < s.minimum) out.push(`${path}: below ${s.minimum}`);
    if (s.maximum !== undefined && v > s.maximum) out.push(`${path}: above ${s.maximum}`);
  }
  if (typeof v === "string") {
    if (s.minLength !== undefined && v.length < s.minLength) out.push(`${path}: shorter than ${s.minLength}`);
    if (s.maxLength !== undefined && v.length > s.maxLength) out.push(`${path}: longer than ${s.maxLength}`);
    if (s.pattern && !new RegExp(s.pattern, "u").test(v)) out.push(`${path}: does not match ${s.pattern}`);
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) out.push(`${path}: fewer than ${s.minItems} items`);
    if (s.items) v.forEach((x, i) => check(s.items, x, `${path}[${i}]`, out));
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const k of s.required || []) if (!(k in v)) out.push(`${path}.${k}: missing`);
    for (const [k, sub] of Object.entries(s.properties || {})) if (k in v) check(sub, v[k], `${path}.${k}`, out);
  }
  return out;
}

/** The problems of `value` against spec/esim-v1/<name> ([] when it conforms). */
export function validate(name, value) {
  const s = schemas.get(name.endsWith(".schema.json") ? name : `${name}.schema.json`);
  if (!s) throw new Error(`no schema ${name}`);
  return check(s, value, "$", []);
}
export const schemaNames = () => [...schemas.keys()];
