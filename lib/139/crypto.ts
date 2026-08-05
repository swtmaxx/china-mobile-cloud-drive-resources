import CryptoJS from "crypto-js";

function wordArrayFromBytes(bytes: Uint8Array): CryptoJS.lib.WordArray {
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    words[i >>> 2] = (words[i >>> 2] || 0) | (bytes[i] << (24 - (i % 4) * 8));
  }
  return CryptoJS.lib.WordArray.create(words, bytes.length);
}

function wordArrayToBytes(value: CryptoJS.lib.WordArray): Uint8Array {
  const bytes = new Uint8Array(value.sigBytes);
  for (let i = 0; i < value.sigBytes; i += 1) {
    bytes[i] = (value.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("Invalid hex string");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  return CryptoJS.enc.Base64.stringify(wordArrayFromBytes(bytes));
}

export function base64ToBytes(value: string): Uint8Array {
  return wordArrayToBytes(CryptoJS.enc.Base64.parse(value));
}

export function base64UrlEncode(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return base64ToBytes(padded);
}

export function utf8Base64(value: string): string {
  return bytesToBase64(new TextEncoder().encode(value));
}

export function decodeUtf8Base64(value: string): string {
  return new TextDecoder().decode(base64ToBytes(value));
}

export function md5Hex(value: string): string {
  return CryptoJS.MD5(value).toString(CryptoJS.enc.Hex);
}

export function sha1Hex(value: string): string {
  return CryptoJS.SHA1(value).toString(CryptoJS.enc.Hex);
}

export function encodeURIComponent139(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, " ")
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2A")
    .replace(/ /g, "%20")
    .replace(/%21/g, "!")
    .replace(/%27/g, "'")
    .replace(/%28/g, "(")
    .replace(/%29/g, ")")
    .replace(/%2A/g, "*");
}

export function calculateSign(body: string, timestamp: string, random: string): string {
  const encoded = encodeURIComponent139(body);
  const sorted = Array.from(encoded).sort().join("");
  const sortedBase64 = utf8Base64(sorted);
  return md5Hex(`${md5Hex(sortedBase64)}${md5Hex(`${timestamp}:${random}`)}`).toUpperCase();
}

export function randomString(length: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export function formatChinaTimestamp(date = new Date()): string {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 19).replace("T", " ");
}

export function sortedJsonStringify(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (typeof parsed !== "string") {
        return sortedJsonStringify(parsed);
      }
    } catch {
      // Keep ordinary strings as strings.
    }
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(sortedJsonStringify).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${sortedJsonStringify(item)}`).join(",")}}`;
  }
  return "null";
}

function aesKey(keyHex: string): CryptoJS.lib.WordArray {
  return CryptoJS.enc.Hex.parse(keyHex);
}

export function encryptAesCbcEnvelope(body: unknown, keyHex: string): string {
  const iv = new Uint8Array(16);
  crypto.getRandomValues(iv);
  const encrypted = CryptoJS.AES.encrypt(sortedJsonStringify(body), aesKey(keyHex), {
    iv: wordArrayFromBytes(iv),
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  }).ciphertext;
  const combined = CryptoJS.enc.Hex.parse(`${bytesToHex(iv)}${CryptoJS.enc.Hex.stringify(encrypted)}`);
  return CryptoJS.enc.Base64.stringify(combined);
}

export function decryptAesCbcEnvelope(payload: string, keyHex: string): string {
  const decoded = CryptoJS.enc.Base64.parse(payload);
  const hex = CryptoJS.enc.Hex.stringify(decoded);
  if (hex.length < 64) {
    throw new Error("Encrypted response is too short");
  }
  const iv = CryptoJS.enc.Hex.parse(hex.slice(0, 32));
  const ciphertext = CryptoJS.enc.Hex.parse(hex.slice(32));
  const decrypted = CryptoJS.AES.decrypt(CryptoJS.lib.CipherParams.create({ ciphertext }), aesKey(keyHex), {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  const text = decrypted.toString(CryptoJS.enc.Utf8);
  if (!text) {
    throw new Error("Unable to decrypt AES-CBC response");
  }
  return text;
}

export function decryptAesEcbHex(ciphertextHex: string, keyHex: string): string {
  const ciphertext = CryptoJS.enc.Hex.parse(ciphertextHex);
  const decrypted = CryptoJS.AES.decrypt(CryptoJS.lib.CipherParams.create({ ciphertext }), aesKey(keyHex), {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  });
  const text = decrypted.toString(CryptoJS.enc.Utf8);
  if (!text) {
    throw new Error("Unable to decrypt AES-ECB response");
  }
  return text;
}

export function decodeHexUtf8(value: string): string {
  return new TextDecoder().decode(hexToBytes(value));
}
