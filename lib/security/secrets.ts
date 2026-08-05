import { base64UrlDecode, base64UrlEncode } from "../139/crypto";
import { decodeKeyBytes } from "./keys";

export async function encryptSecret(value: string, secret: string, label = "AUTH_ENCRYPTION_KEY"): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", decodeKeyBytes(secret, label).buffer as ArrayBuffer, "AES-GCM", false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv.buffer as ArrayBuffer }, key, new TextEncoder().encode(value).buffer as ArrayBuffer);
  const output = new Uint8Array(iv.length + encrypted.byteLength);
  output.set(iv, 0);
  output.set(new Uint8Array(encrypted), iv.length);
  return base64UrlEncode(output);
}

export async function decryptSecret(value: string, secret: string, label = "AUTH_ENCRYPTION_KEY"): Promise<string> {
  const encoded = base64UrlDecode(value);
  if (encoded.length < 13) {
    throw new Error("Encrypted secret is invalid");
  }
  const iv = encoded.slice(0, 12);
  const ciphertext = encoded.slice(12);
  const key = await crypto.subtle.importKey("raw", decodeKeyBytes(secret, label).buffer as ArrayBuffer, "AES-GCM", false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv.buffer as ArrayBuffer }, key, ciphertext.buffer as ArrayBuffer);
  return new TextDecoder().decode(decrypted);
}
