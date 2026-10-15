// Base58 (Bitcoin alphabet) for Solana keys and Tron addresses, and Tron's base58check.
import { createHash } from "node:crypto";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const INDEX = new Map([...ALPHABET].map((c, i) => [c, i]));

export function encode(bytes) {
  const b = Uint8Array.from(bytes);
  let zeros = 0;
  while (zeros < b.length && b[zeros] === 0) zeros++;
  let n = 0n;
  for (const x of b) n = n * 256n + BigInt(x);
  let out = "";
  while (n > 0n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  return "1".repeat(zeros) + out;
}

export function decode(text) {
  const s = String(text);
  let n = 0n;
  for (const c of s) {
    const v = INDEX.get(c);
    if (v === undefined) throw new Error("not base58");
    n = n * 58n + BigInt(v);
  }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n % 256n)); n /= 256n; }
  let zeros = 0;
  while (zeros < s.length && s[zeros] === "1") zeros++;
  return Uint8Array.from([...new Array(zeros).fill(0), ...bytes]);
}

const sha256 = (b) => createHash("sha256").update(b).digest();

/** A Tron address (T…, 34 characters): 0x41 + 20 bytes + a 4-byte double-SHA-256 checksum. */
export function isTronAddress(addr) {
  try {
    const b = decode(addr);
    if (b.length !== 25 || b[0] !== 0x41) return false;
    const check = sha256(sha256(b.subarray(0, 21))).subarray(0, 4);
    return Buffer.from(b.subarray(21)).equals(check);
  } catch { return false; }
}

/** A Solana public key: 32 bytes in base58. */
export function isSolanaAddress(addr) {
  try { return decode(addr).length === 32; } catch { return false; }
}
