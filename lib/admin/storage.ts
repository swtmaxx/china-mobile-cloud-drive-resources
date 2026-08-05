import type { Env } from "../env";
import { decryptSecret, encryptSecret } from "../security/secrets";
import { decodeKeyBytes } from "../security/keys";
import { AdminError } from "./errors";

export const ADMIN_PASSWORD_KEY = "admin:password";
export const ADMIN_PROVIDER_KEY = "admin:provider";
export const ADMIN_RESOURCE_RULES_KEY = "admin:resource-rules";
export const ADMIN_DISPLAY_ROOT_KEY = "admin:display-root";
export const ADMIN_SITE_SETTINGS_KEY = "admin:site-settings";
export const ADMIN_SESSION_VERSION_KEY = "admin:session-version";
export const RESOURCE_RULES_VERSION_KEY = "resource-rules:version";
export const PROVIDER_CONFIG_VERSION_KEY = "provider-config:version";
export const DISPLAY_ROOT_VERSION_KEY = "display-root:version";
export const SITE_SETTINGS_VERSION_KEY = "site-settings:version";

export function requireAdminDataKey(env: Env): string {
  if (!env.ADMIN_DATA_KEY) {
    throw new AdminError("ADMIN_DATA_KEY is not configured", 503, "admin_misconfigured");
  }
  try {
    decodeKeyBytes(env.ADMIN_DATA_KEY, "ADMIN_DATA_KEY");
  } catch {
    throw new AdminError("ADMIN_DATA_KEY is invalid", 503, "admin_misconfigured");
  }
  return env.ADMIN_DATA_KEY;
}

export async function readAdminJson<T>(env: Env, key: string): Promise<T | null> {
  const stored = await env.RESOURCE_KV.get(key);
  if (!stored) {
    return null;
  }
  try {
    const plaintext = await decryptSecret(stored, requireAdminDataKey(env), "ADMIN_DATA_KEY");
    return JSON.parse(plaintext) as T;
  } catch (error) {
    if (error instanceof AdminError) {
      throw error;
    }
    throw new AdminError("后台加密数据无法解密", 503, "admin_data_invalid");
  }
}

export async function writeAdminJson(env: Env, key: string, value: unknown): Promise<void> {
  const encrypted = await encryptSecret(JSON.stringify(value), requireAdminDataKey(env), "ADMIN_DATA_KEY");
  await env.RESOURCE_KV.put(key, encrypted);
}

export async function deleteAdminValue(env: Env, key: string): Promise<void> {
  await env.RESOURCE_KV.delete(key);
}

export async function readNumericValue(env: Env, key: string, fallback = 0): Promise<number> {
  const value = Number.parseInt((await env.RESOURCE_KV.get(key)) || "", 10);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

export async function incrementNumericValue(env: Env, key: string, fallback = 0): Promise<number> {
  const next = (await readNumericValue(env, key, fallback)) + 1;
  await env.RESOURCE_KV.put(key, String(next));
  return next;
}
