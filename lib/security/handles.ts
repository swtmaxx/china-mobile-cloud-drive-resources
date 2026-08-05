import type { ResourceHandlePayload } from "../139/types";
import { base64UrlDecode, base64UrlEncode } from "../139/crypto";
import { decodeKeyBytes } from "./keys";

const HANDLE_VERSION = "v2";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

async function handleKey(secret: string, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    decodeKeyBytes(secret, "RESOURCE_HANDLE_KEY").buffer as ArrayBuffer,
    "AES-GCM",
    false,
    [usage],
  );
}

function isResourceHandlePayload(value: unknown): value is ResourceHandlePayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const payload = value as Partial<ResourceHandlePayload>;
  return payload.version === 2
    && (payload.kind === "folder" || payload.kind === "file")
    && typeof payload.fileId === "string"
    && payload.fileId.length > 0
    && typeof payload.rootId === "string"
    && payload.rootId.length > 0
    && typeof payload.name === "string"
    && payload.name.length > 0
    && (payload.parentHandle === undefined || typeof payload.parentHandle === "string")
    && (payload.scopeRootId === undefined || (typeof payload.scopeRootId === "string" && payload.scopeRootId.length > 0))
    && typeof payload.expiresAt === "number"
    && Number.isFinite(payload.expiresAt)
    && payload.expiresAt >= Date.now();
}

export async function createResourceHandle(payload: ResourceHandlePayload, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await handleKey(secret, "encrypt");
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    key,
    new TextEncoder().encode(JSON.stringify({ ...payload, version: 2 })).buffer as ArrayBuffer,
  );
  return `${HANDLE_VERSION}.${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(encrypted))}`;
}

export async function verifyResourceHandle(handle: string, secret: string): Promise<ResourceHandlePayload | null> {
  const [version, encodedIv, encodedCiphertext, ...extra] = handle.split(".");
  if (version !== HANDLE_VERSION || !encodedIv || !encodedCiphertext || extra.length > 0) {
    return null;
  }
  try {
    const iv = base64UrlDecode(encodedIv);
    const ciphertext = base64UrlDecode(encodedCiphertext);
    if (iv.length !== IV_LENGTH || ciphertext.length <= AUTH_TAG_LENGTH) {
      return null;
    }
    const key = await handleKey(secret, "decrypt");
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
      key,
      ciphertext.buffer as ArrayBuffer,
    );
    const payload = JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
    return isResourceHandlePayload(payload) ? payload : null;
  } catch {
    return null;
  }
}
