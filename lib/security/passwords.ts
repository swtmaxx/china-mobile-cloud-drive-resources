import { base64UrlDecode, base64UrlEncode } from "../139/crypto";

const HASH_ALGORITHM = "pbkdf2-sha256";
const DEFAULT_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

async function derivePassword(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password).buffer as ArrayBuffer,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt.buffer as ArrayBuffer, iterations, hash: "SHA-256" },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export function isAcceptablePassword(password: string): boolean {
  return password.length >= 8 && password.length <= 256;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derivePassword(password, salt, DEFAULT_ITERATIONS);
  return `${HASH_ALGORITHM}$${DEFAULT_ITERATIONS}$${base64UrlEncode(salt)}$${base64UrlEncode(hash)}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, iterationsText, encodedSalt, encodedHash, ...extra] = encoded.split("$");
  const iterations = Number.parseInt(iterationsText || "", 10);
  if (algorithm !== HASH_ALGORITHM || extra.length > 0 || !Number.isSafeInteger(iterations) || iterations < 100_000 || iterations > 1_000_000) {
    return false;
  }
  try {
    const salt = base64UrlDecode(encodedSalt || "");
    const expected = base64UrlDecode(encodedHash || "");
    if (salt.length < 8 || expected.length !== HASH_BYTES) {
      return false;
    }
    const actual = await derivePassword(password, salt, iterations);
    return equalBytes(actual, expected);
  } catch {
    return false;
  }
}

export function equalPasswordValues(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  return equalBytes(leftBytes, rightBytes);
}
