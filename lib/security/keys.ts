import { base64UrlDecode } from "../139/crypto";

export function decodeKeyBytes(value: string, label: string): Uint8Array {
  const trimmed = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i += 1) {
      bytes[i] = Number.parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }
  const bytes = base64UrlDecode(trimmed);
  if (bytes.length !== 32) {
    throw new Error(`${label} must decode to 32 bytes`);
  }
  return bytes;
}
